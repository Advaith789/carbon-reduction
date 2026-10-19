/*
 * Campus3D — the same ten buildings as the 2D map, drawn as extruded columns.
 *
 * Column **height** and **colour** both encode tonnes CO₂e (one measure, two
 * channels — redundant on purpose, because a pitched camera foreshortens height
 * and colour survives that). Column **footprint** is the same √tonnes rule the 2D
 * circles use, so a building reads at the same relative size in either view. The
 * basemap's own building footprints are extruded to their mapped heights in a
 * neutral grey so the columns sit in a recognisable campus rather than on a flat
 * plane; they carry no data and are drawn translucent.
 *
 * Rendering is MapLibre GL (WebGL) over OpenFreeMap's vector tiles — a public,
 * keyless service built from OpenStreetMap. If the style cannot load (offline,
 * blocked, or the service is down) the component reports it through
 * `onUnavailable` so the page can fall back to the 2D Leaflet map rather than
 * showing a blank canvas. Nothing is computed here: every figure in a popup is a
 * field the agent returned.
 */

import React, { useEffect, useRef } from 'react';
import maplibregl, { type Map as MlMap, type MapGeoJSONFeature } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

import { MAP_STROKE, mapRampColor } from '@/lib/badger/palette';
import { pct, signedPct, tonnes } from '@/lib/badger/format';
import type { BuildingForecast } from '@/types/badger';

/** What the page derives per building; the 2D and 3D views share this shape. */
export interface BuildingPoint {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  tonnes: number;
  /** 0–1 share of campus purchasing carbon. */
  campusShare: number;
  departments: number;
  dominant: { name: string; share: number; campusShare: number } | null;
  forecast: BuildingForecast | null;
}

interface Campus3DProps {
  points: BuildingPoint[];
  maxTonnes: number;
  center: [number, number];
  /** Called once if the basemap style fails to load, with a short reason. */
  onUnavailable?: (reason: string) => void;
  className?: string;
}

/** OpenFreeMap "Liberty" — OpenStreetMap data, public, no key. */
const STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';

/* Column geometry, in metres. Footprint follows the 2D √tonnes rule; height is
 * linear in tonnes so the tallest column is unmistakably the biggest emitter. */
const RADIUS_MIN_M = 18;
const RADIUS_SPAN_M = 26;
const HEIGHT_MIN_M = 30;
const HEIGHT_SPAN_M = 330;

/** Approximate metres per degree at the campus latitude (~43°N). */
const M_PER_DEG_LAT = 111_320;
const M_PER_DEG_LNG = 111_320 * Math.cos((43.07 * Math.PI) / 180);

/** A 12-sided polygon around a point — close enough to a cylinder for a column. */
function disc(lng: number, lat: number, radiusM: number): number[][] {
  const ring: number[][] = [];
  for (let i = 0; i <= 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    ring.push([
      lng + (Math.cos(a) * radiusM) / M_PER_DEG_LNG,
      lat + (Math.sin(a) * radiusM) / M_PER_DEG_LAT,
    ]);
  }
  return ring;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** The popup card — same content as the 2D hover card, as safe HTML. */
function cardHtml(p: BuildingPoint): string {
  const dir = p.forecast?.direction ?? 'flat';
  const dirColour = dir === 'rising' ? '#b45309' : dir === 'falling' ? '#15803d' : 'inherit';
  const range = p.forecast
    ? (() => {
        const mid = p.forecast.next12MonthsTonnes ?? 0;
        const band = (p.forecast.confidenceBandTonnes ?? 0) * Math.sqrt(12);
        return `${Math.round(Math.max(0, mid - band))}–${Math.round(mid + band)} tCO₂e`;
      })()
    : null;

  return `
    <div style="width:240px">
      <p style="font-size:13px;font-weight:600;line-height:1.2;margin:0">${esc(p.name)}</p>
      <p style="margin:3px 0 0;opacity:.7"><b style="opacity:1;font-variant-numeric:tabular-nums">${esc(tonnes(p.tonnes))}</b> · ${esc(pct(p.campusShare, 1))} of campus purchasing carbon</p>
      ${
        p.dominant
          ? `<p style="margin:8px 0 0;line-height:1.35"><span style="opacity:.7">Mostly </span><b>${esc(p.dominant.name)}</b><span style="opacity:.7"> — ${esc(pct(p.dominant.share, 0))} of this building, and ${esc(pct(p.dominant.campusShare, 0))} of everything campus buys in it.</span></p>`
          : ''
      }
      <p style="margin:4px 0 0;opacity:.7">${p.departments} department${p.departments === 1 ? '' : 's'} ordering independently from this address.</p>
      ${
        p.forecast && range
          ? `<div style="margin-top:8px;padding-top:8px;border-top:1px solid rgba(0,0,0,.14)">
               <p style="margin:0;font-size:10px;font-weight:600;letter-spacing:.07em;text-transform:uppercase;opacity:.8">Modelled · next 12 months</p>
               <p style="margin:4px 0 0"><b style="font-variant-numeric:tabular-nums">${esc(range)}</b> <b style="margin-left:6px;color:${dirColour}">${esc(dir)} ${esc(signedPct(p.forecast.changePct))}</b></p>
               <p style="margin:2px 0 0;font-size:10px;opacity:.6">Peak month ${esc(p.forecast.peakMonth ?? '—')} · fit R² ${(p.forecast.rSquared ?? 0).toFixed(2)} on ${p.forecast.observationCount} months</p>
             </div>`
          : ''
      }
    </div>`;
}

export default function Campus3D({ points, maxTonnes, center, onUnavailable, className }: Campus3DProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const unavailableRef = useRef(onUnavailable);
  unavailableRef.current = onUnavailable;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const map = new maplibregl.Map({
      container: el,
      style: STYLE_URL,
      center: [center[1], center[0]],
      zoom: 15.4,
      pitch: 58,
      bearing: -18,
      canvasContextAttributes: { antialias: true },
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');

    let reported = false;
    const fail = (reason: string) => {
      if (reported) return;
      reported = true;
      unavailableRef.current?.(reason);
    };
    // A style that never arrives is the common failure; give it a bounded wait.
    const timer = window.setTimeout(() => {
      if (!map.isStyleLoaded()) fail('The 3D basemap did not load in time.');
    }, 12_000);
    map.on('error', (e) => {
      const msg = String(e?.error?.message ?? '');
      // Tile 404s for empty areas are routine; only a style/source failure matters.
      if (/style|source|Failed to fetch|NetworkError/i.test(msg)) fail(msg || 'The 3D basemap failed to load.');
    });

    const byId = new Map(points.map((p) => [p.id, p]));
    const popup = new maplibregl.Popup({
      closeButton: false,
      closeOnClick: false,
      offset: 14,
      className: 'badger-map-popup',
    });

    map.on('load', () => {
      window.clearTimeout(timer);

      // 1. The basemap's own buildings, extruded to their mapped heights in neutral
      //    grey. Guarded: if the style lacks the layer, the columns still draw.
      const style = map.getStyle();
      const hasBuildings = (style?.layers ?? []).some(
        (l) => 'source-layer' in l && (l as { 'source-layer'?: string })['source-layer'] === 'building',
      );
      if (hasBuildings) {
        // Hide the flat building fill so the extrusion is the only building mark.
        for (const l of style.layers) {
          if ('source-layer' in l && (l as { 'source-layer'?: string })['source-layer'] === 'building') {
            map.setLayoutProperty(l.id, 'visibility', 'none');
          }
        }
        map.addLayer({
          id: 'badger-osm-buildings',
          type: 'fill-extrusion',
          source: 'openmaptiles',
          'source-layer': 'building',
          minzoom: 13,
          paint: {
            'fill-extrusion-color': '#cfd4da',
            'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 12],
            'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
            'fill-extrusion-opacity': 0.55,
          },
        });
      }

      // 2. Our data: one column per building.
      map.addSource('badger-columns', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: points.map((p) => {
            const share = maxTonnes > 0 ? p.tonnes / maxTonnes : 0;
            return {
              type: 'Feature',
              id: p.id,
              properties: {
                id: p.id,
                name: p.name,
                tonnes: p.tonnes,
                label: tonnes(p.tonnes),
                height: HEIGHT_MIN_M + HEIGHT_SPAN_M * share,
                colour: mapRampColor(p.tonnes, maxTonnes),
              },
              geometry: {
                type: 'Polygon',
                coordinates: [disc(p.longitude, p.latitude, RADIUS_MIN_M + RADIUS_SPAN_M * Math.sqrt(share))],
              },
            };
          }),
        },
      });
      map.addLayer({
        id: 'badger-columns',
        type: 'fill-extrusion',
        source: 'badger-columns',
        paint: {
          'fill-extrusion-color': ['get', 'colour'],
          'fill-extrusion-height': ['get', 'height'],
          'fill-extrusion-base': 0,
          'fill-extrusion-opacity': 0.92,
          'fill-extrusion-vertical-gradient': true,
        },
      });
      // Direct labels: the building and its tonnage, floating over each column.
      map.addLayer({
        id: 'badger-column-labels',
        type: 'symbol',
        source: 'badger-columns',
        layout: {
          'text-field': ['format', ['get', 'name'], {}, '\n', {}, ['get', 'label'], { 'font-scale': 0.9 }],
          'text-size': 11,
          'text-anchor': 'bottom',
          'text-offset': [0, -0.6],
          'text-allow-overlap': false,
          'text-max-width': 9,
        },
        paint: {
          'text-color': '#ffffff',
          'text-halo-color': 'rgba(0,0,0,0.85)',
          'text-halo-width': 1.4,
        },
      });

      // 3. Hover → the same card the 2D map shows.
      let hovered: string | number | null = null;
      map.on('mousemove', 'badger-columns', (e) => {
        const f = e.features?.[0] as MapGeoJSONFeature | undefined;
        const id = f?.properties?.id as string | undefined;
        if (!id) return;
        map.getCanvas().style.cursor = 'pointer';
        if (hovered !== id) {
          hovered = id;
          const p = byId.get(id);
          if (p) popup.setLngLat([p.longitude, p.latitude]).setHTML(cardHtml(p)).addTo(map);
        }
      });
      map.on('mouseleave', 'badger-columns', () => {
        hovered = null;
        map.getCanvas().style.cursor = '';
        popup.remove();
      });
    });

    return () => {
      window.clearTimeout(timer);
      popup.remove();
      map.remove();
      mapRef.current = null;
    };
    // Points and extents only change when the dataset reloads; rebuilding the map
    // then is correct and cheap. `center` is a constant.
  }, [points, maxTonnes, center]);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ height: '100%', width: '100%', outline: `1px solid ${MAP_STROKE}` }}
      role="img"
      aria-label="Three-dimensional campus map: one column per building, height and colour both proportional to purchasing emissions"
    />
  );
}
