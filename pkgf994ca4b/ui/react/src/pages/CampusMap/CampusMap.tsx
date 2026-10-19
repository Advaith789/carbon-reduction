/*
 * Campus map — the same footprint, placed on the ground.
 *
 * **Two things only:** the map, and "what each building buys" — a stacked bar per
 * building (how much, and what kind) over ranked per-building breakdowns. The
 * building × category heatmap this replaced was 10 × 13 with more than half its
 * cells empty, so the eye read the gaps; see `BuildingComposition` for the forms
 * that replaced it. The stat row, the ranked bar list and the "who shares a
 * building" panel were all cut — the ranking is already the whole of the
 * Footprint page, and everything the selected-building panel used to show now
 * lives in the hover card, where it costs no layout.
 *
 * Hover is the primary interaction here, so the card has to carry real content.
 * It is split by a rule into a measured half — magnitude, share of campus, spend,
 * basket intensity, how many departments order independently from the same address,
 * and the category dominating the mix — and a modelled half carrying ForecastAgent's
 * twelve-month projection. That rule is the whole point: it is the only place in the
 * app where measured and projected figures sit together, so the boundary between
 * them is drawn explicitly rather than left to the reader.
 *
 * **Nothing here is computed in the browser.** Both halves come off an agent:
 * `BadgerAnalytics.buildingMap` for everything measured, `ForecastAgent` for
 * everything fitted. This file picks coordinates, colours and words. It used to
 * roll the heatmap up itself from the department × category ledger, which meant
 * the spend-based emission factor was applied twice — once in Rhino for the
 * totals, once in TypeScript for the cells beside them.
 */

import React, { Suspense, lazy, useCallback, useMemo, useState } from 'react';
import {
  CircleMarker,
  LayersControl,
  MapContainer,
  TileLayer,
  Tooltip as LeafletTooltip,
} from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import './CampusMap.css';

import type { BuildingPoint } from './Campus3D';

/* MapLibre is ~1 MB minified. Loading it on demand keeps it out of the main
   bundle, so every other page pays nothing for the 3D view. The type import above
   is erased at build time and does not pull the module in. */
const Campus3D = lazy(() => import('./Campus3D'));
import { Button } from '@/components/ui/button';

import PageShell, { Section } from '@/components/badger/PageShell';
import Panel from '@/components/badger/Panel';
import { BuildingBreakdowns, BuildingStackedBars } from '@/components/badger/BuildingComposition';
import CopilotPanel from '@/components/badger/CopilotPanel';
import { ErrorState, LoadingBlock } from '@/components/badger/DataState';
import { useBadgerData } from '@/contexts/BadgerDataProvider';
import { MAP_RAMP, MAP_STROKE, STATUS, mapRampColor } from '@/lib/badger/palette';
import { pct, signedPct, tonnes } from '@/lib/badger/format';
import type { BuildingForecast, BuildingMapRow } from '@/types/badger';

/** Centre of the UW–Madison campus, used as the map's initial view. */
const CAMPUS_CENTER: [number, number] = [43.0744, -89.4063];

/**
 * Esri basemaps — public ArcGIS Online tile services, no API key, no extra package.
 *
 * Satellite imagery is the default because the point of this page is recognising
 * the ground: Bascom Hill, the Lakeshore path, Camp Randall. A reference layer of
 * place names and roads is drawn on top of the imagery so the picture stays
 * readable. Topographic and street styles are offered through the layer switcher
 * for presentations where a lighter, flatter map reads better on a projector.
 *
 * Esri's terms require their attribution to stay visible; it is passed to Leaflet's
 * attribution control for every layer below.
 */
const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services';
const ESRI_IMAGERY_URL = `${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`;
const ESRI_LABELS_URL = `${ESRI}/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`;
const ESRI_TRANSPORT_URL = `${ESRI}/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}`;
const ESRI_TOPO_URL = `${ESRI}/World_Topo_Map/MapServer/tile/{z}/{y}/{x}`;
const ESRI_STREET_URL = `${ESRI}/World_Street_Map/MapServer/tile/{z}/{y}/{x}`;
const ESRI_IMAGERY_ATTRIBUTION =
  'Tiles &copy; <a href="https://www.esri.com/">Esri</a> &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community';
const ESRI_TOPO_ATTRIBUTION =
  'Tiles &copy; <a href="https://www.esri.com/">Esri</a> &mdash; Esri, HERE, Garmin, USGS, NGA, and the GIS User Community';
const ESRI_STREET_ATTRIBUTION =
  'Tiles &copy; <a href="https://www.esri.com/">Esri</a> &mdash; Esri, HERE, Garmin, USGS, Intermap, NRCAN, and the GIS User Community';

/** Legend labels for the five {@link MAP_RAMP} steps, lowest first. */
const RAMP_LABELS = ['lowest', '', 'mid', '', 'highest'] as const;

/**
 * The 95% prediction interval for the twelve-month total, as a range string.
 *
 * `confidenceBandTonnes` is the half-width for a *single* month. Twelve monthly
 * errors do not all land the same way, so the annual band is not twelve times the
 * monthly one — independent errors add in quadrature, giving √12. Multiplying by
 * 12 would overstate the uncertainty by about 3.5×, which is as misleading as
 * understating it. The lower bound clamps at zero: a building cannot buy negative
 * carbon.
 */
function forecastRange(f: BuildingForecast): string {
  const mid = f.next12MonthsTonnes ?? 0;
  const annualBand = (f.confidenceBandTonnes ?? 0) * Math.sqrt(12);
  const lo = Math.max(0, mid - annualBand);
  return `${Math.round(lo)}–${Math.round(mid + annualBand)} tCO₂e`;
}

/** Status colour for the trend arrow. Rising emissions are bad, falling is good. */
function directionColor(direction: BuildingForecast['direction']): string {
  if (direction === 'rising') return STATUS.warning;
  if (direction === 'falling') return STATUS.good;
  return 'inherit';
}

export default function CampusMap() {
  const { data, loading, error, reload } = useBadgerData();

  /* 3D is the default because it is the view that makes magnitude legible at a
     glance; 2D stays one click away for projectors and for readers who prefer
     imagery. If the 3D basemap cannot load we drop to 2D automatically and say so,
     rather than leaving a blank canvas. */
  const [view, setView] = useState<'3d' | '2d'>('3d');
  const [threeDNote, setThreeDNote] = useState<string | null>(null);
  const fallbackTo2D = useCallback((reason: string) => {
    setView('2d');
    setThreeDNote(`3D view unavailable (${reason}). Showing the 2D map instead.`);
  }, []);

  const derived = useMemo(() => {
    if (!data) return null;
    const map = data.buildingMap;

    const maxTonnes = Math.max(...map.buildings.map((b) => b.tonnes), 0) || 1;

    // Cells keyed `buildingId|categoryId`, so the hover card can look up the
    // dominant category's campus-wide share without a second pass.
    const cells = new Map(map.matrix.map((c) => [`${c.buildingId}|${c.categoryId}`, c]));

    // ForecastAgent's fitted projection, keyed by building so hovering costs nothing.
    const forecastById = new Map((data.forecast?.rows ?? []).map((f) => [f.buildingId, f]));

    const points: BuildingPoint[] = map.buildings
      // A building seeded without coordinates still counts toward every total;
      // it just cannot be drawn. The predicate narrows the nullable pair so the
      // marker below gets a `[number, number]` without a cast.
      .filter(
        (b): b is BuildingMapRow & { latitude: number; longitude: number } =>
          typeof b.latitude === 'number' && typeof b.longitude === 'number',
      )
      .map((b) => {
        const f = forecastById.get(b.id);
        const dom = b.dominantCategoryId
          ? cells.get(`${b.id}|${b.dominantCategoryId}`)
          : undefined;
        return {
          id: b.id,
          name: b.name,
          latitude: b.latitude,
          longitude: b.longitude,
          tonnes: b.tonnes,
          spend: b.spend,
          kgPerDollar: b.kgPerDollar,
          departments: b.departmentCount,
          // The agent states every share as a 0–100 double while `pct()` takes a
          // 0–1 fraction. Divided once here, at the boundary, rather than at each
          // call site where a missed division renders 18.5% as "1850%".
          campusShare: b.sharePct / 100,
          dominant: b.dominantCategoryName
            ? {
                name: b.dominantCategoryName,
                /** Share of *this building's* carbon — what kind it buys. */
                share: b.dominantCategorySharePct / 100,
                /** Share of *all campus* carbon in that category — the figure
                 *  that says whether one visit here moves a campus-wide lever. */
                campusShare: (dom?.categorySharePct ?? 0) / 100,
              }
            : null,
          forecast: f && f.fittable ? f : null,
        };
      })
      // Draw small circles last so they are not hidden under big ones.
      .sort((a, b) => b.tonnes - a.tonnes);

    return { points, maxTonnes };
  }, [data]);

  if (error) {
    return (
      <PageShell title="Campus map">
        <ErrorState message={error} onRetry={reload} />
      </PageShell>
    );
  }

  if (loading || !data || !derived) {
    return (
      <PageShell kicker="Past · Measure" title="The footprint, on the ground">
        <LoadingBlock height={460} label="Loading buildings…" />
      </PageShell>
    );
  }

  return (
    <PageShell
      kicker={`Past · Measured · FY${data.baselineFy}`}
      title="The footprint, on the ground"
      standfirst="Purchasing carbon has an address. Placing it on campus turns an accounting total into something operational: buildings where several departments order the same things, separately, from the same vendors, in the same week."
    >
      {/* ------------------------------ 1. the map --------------------------- */}
      <Section
        title="Carbon by building"
        description={
          view === '3d'
            ? 'Each column is a building; its height and colour are both tonnes CO₂e, so the biggest emitter is the tallest and the reddest. Drag to orbit, scroll to zoom, hover a column for its profile and a fitted twelve-month projection.'
            : 'Circle area is tonnes CO₂e; colour is the same measure on a yellow → red ramp. Hover any building for its profile and a fitted twelve-month projection; switch basemaps from the control in the top-right corner.'
        }
        actions={
          <div className="flex items-center gap-1.5" role="group" aria-label="Map view">
            <Button
              size="sm"
              variant={view === '3d' ? 'solid' : 'outline'}
              appearance={view === '3d' ? 'accent' : 'secondary'}
              aria-pressed={view === '3d'}
              onClick={() => {
                setThreeDNote(null);
                setView('3d');
              }}
            >
              3D columns
            </Button>
            <Button
              size="sm"
              variant={view === '2d' ? 'solid' : 'outline'}
              appearance={view === '2d' ? 'accent' : 'secondary'}
              aria-pressed={view === '2d'}
              onClick={() => setView('2d')}
            >
              2D map
            </Button>
          </div>
        }
      >
        {threeDNote ? (
          <p className="mb-2 text-[11px] text-[var(--c3-style-basic-fg-secondary)]">{threeDNote}</p>
        ) : null}
        <Panel
          bodyClassName="p-0"
          /* The interpretation sentence is the agent's own, returned with the
             figures rather than written here, so the caveat cannot drift away
             from the method that needs it. */
          note={`Spend-based estimate for FY${data.buildingMap.fiscalYear}, attributed to the building each ordering department occupies. ${data.buildingMap.interpretation} ${
            view === '3d'
              ? 'Basemap © OpenFreeMap, © OpenStreetMap contributors; building heights from OpenStreetMap.'
              : 'Basemap tiles © Esri.'
          }`}
        >
          <div className="relative h-[560px] w-full overflow-hidden rounded-[var(--c3-style-border-radius-6)]">
            {view === '3d' ? (
              <Suspense fallback={<LoadingBlock height={560} label="Loading the 3D view…" />}>
                <Campus3D
                  points={derived.points}
                  maxTonnes={derived.maxTonnes}
                  center={CAMPUS_CENTER}
                  onUnavailable={fallbackTo2D}
                />
              </Suspense>
            ) : (
            <MapContainer
              center={CAMPUS_CENTER}
              zoom={16}
              scrollWheelZoom={false}
              style={{
                height: '100%',
                width: '100%',
                background: 'var(--c3-style-basic-bg-primary)',
              }}
              attributionControl
            >
              <LayersControl position="topright">
                <LayersControl.BaseLayer checked name="Satellite">
                  <TileLayer url={ESRI_IMAGERY_URL} attribution={ESRI_IMAGERY_ATTRIBUTION} maxZoom={19} />
                </LayersControl.BaseLayer>
                <LayersControl.BaseLayer name="Topographic">
                  <TileLayer url={ESRI_TOPO_URL} attribution={ESRI_TOPO_ATTRIBUTION} maxZoom={19} />
                </LayersControl.BaseLayer>
                <LayersControl.BaseLayer name="Streets">
                  <TileLayer url={ESRI_STREET_URL} attribution={ESRI_STREET_ATTRIBUTION} maxZoom={19} />
                </LayersControl.BaseLayer>
                {/* Reference layers sit above the imagery so building and street
                    names stay readable on the photograph. They are redundant on the
                    topographic and street styles, which carry their own labels. */}
                <LayersControl.Overlay checked name="Roads">
                  <TileLayer url={ESRI_TRANSPORT_URL} maxZoom={19} />
                </LayersControl.Overlay>
                <LayersControl.Overlay checked name="Place names">
                  <TileLayer url={ESRI_LABELS_URL} maxZoom={19} />
                </LayersControl.Overlay>
              </LayersControl>
              {derived.points.map((p) => (
                <CircleMarker
                  key={p.id}
                  center={[p.latitude, p.longitude]}
                  // Area ∝ tonnes, so radius ∝ √tonnes. Encoding magnitude by
                  // radius would exaggerate the big buildings ~4×.
                  radius={8 + 24 * Math.sqrt(p.tonnes / derived.maxTonnes)}
                  pathOptions={{
                    color: MAP_STROKE,
                    weight: 1.5,
                    fillColor: mapRampColor(p.tonnes, derived.maxTonnes),
                    fillOpacity: 0.8,
                  }}
                >
                  {/* `badger-map-tooltip` overrides Leaflet's `white-space: nowrap`
                      (see globals.css) so the card wraps instead of running off in
                      one line. The card is deliberately short: what the building
                      emits, what kind of buying drives it, and whether that lever
                      matters campus-wide — the figures a buyer acts on. Spend and
                      basket intensity live on the Footprint page. */}
                  <LeafletTooltip
                    direction="top"
                    offset={[0, -6]}
                    opacity={1}
                    className="badger-map-tooltip"
                  >
                    <div className="w-[240px]">
                      <p className="text-[13px] font-semibold leading-tight">{p.name}</p>
                      <p className="mt-0.5 text-[11px] opacity-70">
                        <span className="font-semibold tabular-nums opacity-100">{tonnes(p.tonnes)}</span>
                        {' · '}
                        {pct(p.campusShare, 1)} of campus purchasing carbon
                      </p>

                      {p.dominant ? (
                        <p className="mt-2 text-[11px] leading-snug">
                          <span className="opacity-70">Mostly </span>
                          <span className="font-semibold">{p.dominant.name}</span>
                          <span className="opacity-70">
                            {' '}— {pct(p.dominant.share, 0)} of this building, and{' '}
                            {pct(p.dominant.campusShare, 0)} of everything campus buys in it.
                          </span>
                        </p>
                      ) : null}
                      <p className="mt-1 text-[11px] opacity-70">
                        {p.departments} department{p.departments === 1 ? '' : 's'} ordering
                        independently from this address.
                      </p>

                      {/* ------- the projected half of the card -------------- *
                       * Everything above this rule is measured; below is fitted.
                       * The range comes before the direction deliberately — at an
                       * R² of ~0.2 the band is the honest figure.              */}
                      {p.forecast ? (
                        <div
                          className="mt-2 border-t pt-2"
                          style={{ borderColor: 'rgba(0,0,0,0.14)' }}
                        >
                          <p className="text-[10px] font-semibold uppercase tracking-[0.07em] opacity-80">
                            Modelled · next 12 months
                          </p>
                          <p className="mt-1 text-[11px] leading-snug">
                            <span className="font-semibold tabular-nums">
                              {forecastRange(p.forecast)}
                            </span>
                            <span
                              className="ml-1.5 font-semibold"
                              style={{ color: directionColor(p.forecast.direction) }}
                            >
                              {p.forecast.direction} {signedPct(p.forecast.changePct)}
                            </span>
                          </p>
                          <p className="mt-0.5 text-[10px] leading-snug opacity-60">
                            Peak month {p.forecast.peakMonth ?? '—'} · fit R²{' '}
                            {(p.forecast.rSquared ?? 0).toFixed(2)} on {p.forecast.observationCount}{' '}
                            months
                          </p>
                        </div>
                      ) : null}
                    </div>
                  </LeafletTooltip>
                </CircleMarker>
              ))}
            </MapContainer>
            )}

            {/* Legend. Sits above Leaflet's panes (which stop at z-index 1000)
                and ignores the pointer so it never swallows a marker hover. */}
            <div
              className="pointer-events-none absolute bottom-6 left-3 z-[1001] rounded-[var(--c3-style-border-radius-6)] px-3 py-2 text-[11px] text-white shadow-md"
              style={{ background: 'rgba(17,17,17,0.78)' }}
              aria-hidden
            >
              <p className="font-semibold">Purchasing carbon, FY{data.buildingMap.fiscalYear}</p>
              <div className="mt-1.5 flex items-end gap-1">
                {MAP_RAMP.map((colour, i) => (
                  <div key={colour} className="flex flex-col items-center gap-0.5">
                    <span
                      className="block h-3 w-7 rounded-[2px]"
                      style={{ background: colour, boxShadow: `inset 0 0 0 1px ${MAP_STROKE}` }}
                    />
                    <span className="h-3 text-[9px] leading-none opacity-80">{RAMP_LABELS[i]}</span>
                  </div>
                ))}
              </div>
              <p className="mt-1 opacity-80">
                {view === '3d'
                  ? 'Column height & colour ∝ tonnes CO₂e · hover a column'
                  : 'Circle area ∝ tonnes CO₂e · hover for detail'}
              </p>
            </div>
          </div>
        </Panel>
      </Section>

      {/* ------------------------ 2. what each building buys ------------------ */}
      <Section
        title="What each building buys"
        description="Nobody is doing anything wrong here. Each department has its own budget, its own stockroom and its own preferred vendor — so neighbours in the same building independently order the same consumables, and each order carries its own freight."
      >
        <div className="flex flex-col gap-3">
          <Panel
            title="How much, and what kind"
            subtitle="One bar per building, longest first. Colour says which kind of purchasing drives it — and therefore which lever applies."
            note="Tonnes CO₂e, spend-based, FY2024. The thirteen spend categories are grouped by the lever that reduces them: lab consumables & gases (share stock, consolidate, recapture), equipment & furnishings (refurbish, extend refresh cycles), operations & admin (travel and licensing policy). Hover a bar for the split."
          >
            <BuildingStackedBars
              buildings={data.buildingMap.buildings}
              categories={data.buildingMap.categories}
              matrix={data.buildingMap.matrix}
              totalTonnes={data.buildingMap.totalTonnes}
            />
          </Panel>

          <Panel
            title="Building by building"
            subtitle="Only the categories each building actually buys, ranked. The top line in each card is the one to walk over for."
            note="Hover a category for its share of the building and its share of all campus carbon in that category — a line can be half of one building and still a sliver of what campus buys, in which case fixing it here fixes little; the reverse is the trip worth making."
          >
            <BuildingBreakdowns
              buildings={data.buildingMap.buildings}
              categories={data.buildingMap.categories}
              matrix={data.buildingMap.matrix}
              totalTonnes={data.buildingMap.totalTonnes}
            />
          </Panel>
        </div>
      </Section>

      {/* ---------------------------- 3. the copilot ------------------------- */}
      {/*
        Geography is where the two groups this app exists to connect — buildings
        and departments — actually meet, so it is the most productive place to ask
        a question that spans agents. "Which building is worst, and what spare
        stock is sitting in it?" needs the analytics rollup *and* the intercept's
        inventory match, and the answer is a walk across a courtyard.
      */}
      <Section
        title="Ask about a building"
        description="Buildings and departments are both rollup dimensions, so a question can start in one and finish in the other — which is how a map becomes a work order."
      >
        <CopilotPanel
          page="map"
          suggestions={[
            'Which building has the highest emissions, and is there reusable stock inside it?',
            'Which two buildings sit closest together with the same dominant category?',
            'Which departments share a building but buy from different vendors?',
          ]}
        />
      </Section>
    </PageShell>
  );
}
