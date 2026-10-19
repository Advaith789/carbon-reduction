/*
 * Agent 2 implementation. See InterceptAgent.c3typ for the method contracts.
 *
 * Shape of this file:
 *  - string / geo / rounding helpers
 *  - _ctx(): every lookup table the evaluator needs, loaded exactly once per call so that
 *    scoring 13 requests does not issue 13 x 6 fetches
 *  - _evaluate(req, ctx): the ladder - reuse, substitute, consolidate, defer - plus the
 *    stacked recommendation
 *  - the four public methods
 *
 * Rhino notes: no let/const/arrow functions/template literals, no Object.keys, and lookup
 * tables are keyed with a '#' prefix so a product name like "constructor" cannot collide with
 * Object.prototype.
 */

var BASELINE_FY = 2024;
var NEARBY_METERS = 400;
var EARTH_RADIUS_M = 6371000;

/*
 * Share of a consolidated order's value assumed to be freight. Used only to size the
 * logistics saving from merging deliveries; reported with method 'estimated_logistics' so the
 * assumption travels with the number.
 */
var SHIPPING_SHARE_OF_ORDER = 0.02;

/*
 * Tokens that carry no matching signal in a product line. Space-delimited for a no-prototype lookup.
 *
 * Packaging and filler words only. Circularity words (refurbished, certified, remanufactured)
 * are deliberately NOT stopwords: they are what distinguishes "Dell Latitude (certified
 * refurbished)" at 39 kg CO2e from "Dell Latitude 3450" at 121 kg, and dropping them collapses
 * the two footprints onto each other. Substitution matching still works with them retained,
 * because it only needs two shared tokens ("dell latitude") to connect the request to the
 * refurbished contract line.
 */
var STOPWORDS = ' new the and for with of a an each case cases box boxes pack packs roll rolls bin lot ' +
                'assorted unopened opened sterile ';

/* Contract-line signals that a line is a circular / lower-carbon alternative to buying new. */
var CIRCULAR_SIGNALS = ['refurb', 'remanufactured', 'pre-owned', 'preowned', 'certified', 'reused', 'take-back'];

var RUNG_RANK = { same_building: 0, same_department: 1, nearby: 2, campus: 3 };

/* ------------------------------------------------------------------ helpers */

/** Copy a C3 collection (or native array) into a plain JS array so it can be sorted. */
function _toArr(coll) {
  var out = [];
  if (!coll) return out;
  var n = coll.length;
  for (var i = 0; i < n; i++) out.push(coll.get ? coll.get(i) : coll[i]);
  return out;
}

function _r3(x) { return Math.round(x * 1000) / 1000; }
function _r1(x) { return Math.round(x * 10) / 10; }
function _r0(x) { return Math.round(x); }
function _pct(part, whole) { return whole > 0 ? Math.round(part / whole * 1000) / 10 : 0; }
function _usd(x) { return '$' + Math.round(x).toString(); }

function _isStop(tok) { return STOPWORDS.indexOf(' ' + tok + ' ') >= 0; }

/**
 * Status a decision action maps to, or null. Explicit switch so no Object.prototype key can slip
 * through. `reset` is the only action that moves a request *backwards*, and it exists because
 * every other action is a real write: without it a reviewer who mis-clicks has no way back, and
 * a queue worked end to end can never be worked again.
 */
function _statusForAction(act) {
  switch (act) {
    case 'reuse':       return 'Reused';
    case 'substitute':  return 'Substituted';
    case 'consolidate': return 'Consolidated';
    case 'approve':     return 'Approved';
    case 'decline':     return 'Declined';
    case 'reset':       return 'Pending';
    default:            return null;
  }
}

/** Pluralise a unit-of-issue label ("each" stays "each", "box" becomes "boxes"). */
function _units(label, n) {
  var l = String(label || 'unit');
  if (n === 1 || l === 'each') return l;
  if (l.charAt(l.length - 1) === 'x' || l.charAt(l.length - 1) === 's') return l + 'es';
  return l + 's';
}

/** Significant lowercase word tokens of a product line. */
function _tokens(s) {
  var out = [];
  if (!s) return out;
  var parts = String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ');
  for (var i = 0; i < parts.length; i++) {
    var p = parts[i];
    if (p.length === 0 || _isStop(p)) continue;
    out.push(p);
  }
  return out;
}

/** Number of distinct significant tokens two product lines share. */
function _overlap(a, b) {
  var seen = {}, n = 0, i;
  for (i = 0; i < a.length; i++) seen['#' + a[i]] = 1;
  for (i = 0; i < b.length; i++) {
    if (seen['#' + b[i]] === 1) { n++; seen['#' + b[i]] = 0; }
  }
  return n;
}

/** True when a contract line advertises itself as a circular alternative to new. */
function _isCircular(name) {
  var low = String(name || '').toLowerCase();
  for (var i = 0; i < CIRCULAR_SIGNALS.length; i++) {
    if (low.indexOf(CIRCULAR_SIGNALS[i]) >= 0) return true;
  }
  return false;
}

/** Great-circle distance in metres, or null when either building lacks coordinates. */
function _meters(aLat, aLon, bLat, bLon) {
  if (aLat === null || aLat === undefined || bLat === null || bLat === undefined) return null;
  if (aLon === null || aLon === undefined || bLon === null || bLon === undefined) return null;
  var rad = Math.PI / 180;
  var dLat = (bLat - aLat) * rad, dLon = (bLon - aLon) * rad;
  var s1 = Math.sin(dLat / 2), s2 = Math.sin(dLon / 2);
  var h = s1 * s1 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * s2 * s2;
  if (h > 1) h = 1;
  return 2 * EARTH_RADIUS_M * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/** Calendar month (1-12) of a datetime, without relying on DateTime accessors in Rhino. */
function _month(dt) {
  return dt ? parseInt(String(dt).substring(5, 7), 10) : 0;
}

/* ------------------------------------------------------------------ context */

/** Flatten a PurchaseRequest into the plain shape the evaluator works with. */
function _flatReq(r) {
  return {
    id: r.id,
    productName: r.productName,
    quantity: r.quantity || 0,
    unitPrice: r.unitPrice || 0,
    amount: r.amount || 0,
    requestedBy: r.requestedBy || null,
    requestDate: r.requestDate ? String(r.requestDate) : null,
    month: _month(r.requestDate),
    status: r.status || 'Pending',
    justification: r.justification || null,
    catId: r.productCategory ? r.productCategory.id : null,
    catName: r.productCategory ? r.productCategory.name : 'Unclassified',
    deptId: r.department ? r.department.id : null,
    deptName: r.department ? r.department.name : 'Unattributed',
    bldgId: r.building ? r.building.id : null,
    bldgName: r.building ? r.building.name : 'Unknown',
    vendorId: r.vendor ? r.vendor.id : null,
    vendorName: r.vendor ? r.vendor.name : null
  };
}

var REQ_INCLUDE = 'id, productName, quantity, unitPrice, amount, requestedBy, requestDate, status, ' +
                  'justification, productCategory.id, productCategory.name, department.id, ' +
                  'department.name, building.id, building.name, vendor.id, vendor.name';

/**
 * Load every lookup table the ladder needs. One call per public method, shared across all the
 * requests that method scores.
 */
function _ctx(fiscalYear) {
  var ctx = { nearbyMeters: NEARBY_METERS, bldg: {}, factor: {}, catName: {}, inv: [], contracts: [], pcf: [], pending: [] };
  var i, rows, r;

  rows = _toArr(Building.fetch({ include: 'id, name, latitude, longitude', limit: -1 }).objs);
  for (i = 0; i < rows.length; i++) {
    r = rows[i];
    ctx.bldg['#' + r.id] = {
      id: r.id, name: r.name,
      lat: (r.latitude === undefined ? null : r.latitude),
      lon: (r.longitude === undefined ? null : r.longitude)
    };
  }

  rows = _toArr(ProductCategory.fetch({
    include: 'id, name, emissionFactor.kgCo2ePerDollar', limit: -1
  }).objs);
  for (i = 0; i < rows.length; i++) {
    r = rows[i];
    ctx.factor['#' + r.id] = r.emissionFactor ? r.emissionFactor.kgCo2ePerDollar : 0;
    ctx.catName['#' + r.id] = r.name;
  }

  rows = _toArr(InventoryItem.fetch({
    filter: Filter.gt('quantityExcess', 0),
    include: 'id, productName, quantityOnHand, quantityExcess, unitPrice, unitLabel, notes, ' +
             'productCategory.id, department.id, department.name, building.id, building.name',
    limit: -1
  }).objs);
  for (i = 0; i < rows.length; i++) {
    r = rows[i];
    ctx.inv.push({
      id: r.id, productName: r.productName, tokens: _tokens(r.productName),
      onHand: r.quantityOnHand || 0, excess: r.quantityExcess || 0,
      unitPrice: r.unitPrice || 0, unitLabel: r.unitLabel || 'unit', notes: r.notes || null,
      catId: r.productCategory ? r.productCategory.id : null,
      deptId: r.department ? r.department.id : null,
      deptName: r.department ? r.department.name : 'Unknown',
      bldgId: r.building ? r.building.id : null,
      bldgName: r.building ? r.building.name : 'Unknown'
    });
  }

  rows = _toArr(Contract.fetch({
    include: 'id, productName, unitPrice, description, vendor.id, vendor.name', limit: -1
  }).objs);
  for (i = 0; i < rows.length; i++) {
    r = rows[i];
    if (r.unitPrice === undefined || r.unitPrice === null) continue; // catalog-level contract, no comparable line
    ctx.contracts.push({
      id: r.id, productName: r.productName, tokens: _tokens(r.productName),
      unitPrice: r.unitPrice, description: r.description || null,
      circular: _isCircular(r.productName + ' ' + (r.description || '')),
      vendorId: r.vendor ? r.vendor.id : null,
      vendorName: r.vendor ? r.vendor.name : null
    });
  }

  rows = _toArr(ProductFootprint.fetch({
    include: 'id, productName, manufacturer, kgCo2e, lifespanYears, pctManufacturing, source', limit: -1
  }).objs);
  for (i = 0; i < rows.length; i++) {
    r = rows[i];
    ctx.pcf.push({
      id: r.id, productName: r.productName, tokens: _tokens(r.productName),
      kgCo2e: r.kgCo2e || 0,
      pctManufacturing: (r.pctManufacturing === undefined || r.pctManufacturing === null) ? null : r.pctManufacturing,
      source: r.source || null
    });
  }

  rows = _toArr(PurchaseRequest.fetch({
    filter: Filter.eq('status', 'Pending'), include: REQ_INCLUDE, limit: -1
  }).objs);
  for (i = 0; i < rows.length; i++) ctx.pending.push(_flatReq(rows[i]));

  ctx.yearEnd = _yearEndExcess(fiscalYear || BASELINE_FY, ctx);
  return ctx;
}

/**
 * How much of the fiscal-year-end spend spike is above a normal month. Used as the share of a
 * May/June request that is at risk of buying stock nobody uses, so the deferral rung is sized
 * from campus data instead of a magic constant.
 */
function _yearEndExcess(fy, ctx) {
  var rows = _toArr(SpendTransaction.fetch({
    filter: Filter.eq('fiscalYear', fy),
    include: 'id, amount, transactionDate, productCategory.id', limit: -1
  }).objs);
  var monthUsd = {}, total = 0, carbon = 0, i;
  for (i = 0; i < rows.length; i++) {
    var m = _month(rows[i].transactionDate);
    var amt = rows[i].amount || 0;
    monthUsd['#' + m] = (monthUsd['#' + m] || 0) + amt;
    total += amt;
    var f = rows[i].productCategory ? (ctx.factor['#' + rows[i].productCategory.id] || 0) : 0;
    carbon += amt * f / 1000.0;
  }
  var avg = total / 12.0;
  var june = monthUsd['#6'] || 0, may = monthUsd['#5'] || 0;
  // The excess is the part of the two rush months that sits above a baseline month.
  var rush = june + may, baseline = avg * 2;
  var share = rush > 0 ? Math.max(0, (rush - baseline) / rush) : 0;
  return {
    fiscalYear: fy,
    campusTonnes: carbon,
    campusSpend: total,
    averageMonthSpend: avg,
    juneSpend: june,
    maySpend: may,
    juneMultiple: avg > 0 ? _r1(june / avg) : 0,
    excessShare: share
  };
}

/* ------------------------------------------------------------------ matching */

/**
 * Best-matching ProductFootprint for a product line, or null when nothing credible matches.
 * Ties on shared-token count are broken toward the more specific footprint (fewer unmatched
 * tokens of its own), so "Dell Latitude certified refurbished" lands on the refurbished
 * footprint rather than on the new-laptop one.
 */
function _matchPcf(name, ctx) {
  var want = _tokens(name), best = null, bestScore = 0, bestExtra = 0;
  for (var i = 0; i < ctx.pcf.length; i++) {
    var cand = ctx.pcf[i];
    var sc = _overlap(want, cand.tokens);
    if (sc === 0) continue;
    var extra = cand.tokens.length - sc;
    if (sc > bestScore || (sc === bestScore && extra < bestExtra)) {
      bestScore = sc; bestExtra = extra; best = cand;
    }
  }
  return bestScore >= 2 ? best : null;
}

/**
 * Embodied carbon of a request as submitted. Prefers a real product footprint and falls back
 * to the spend-based factor, labelling which was used.
 */
function _requestCarbon(req, ctx) {
  var pcf = _matchPcf(req.productName, ctx);
  if (pcf && pcf.kgCo2e > 0) {
    return {
      tonnes: req.quantity * pcf.kgCo2e / 1000.0,
      method: 'product_footprint',
      basis: pcf.productName + ': ' + pcf.kgCo2e + ' kg CO2e/unit (' + (pcf.source || 'PCF') + ')',
      pcf: pcf
    };
  }
  var f = ctx.factor['#' + req.catId] || 0;
  return {
    tonnes: req.amount * f / 1000.0,
    method: 'spend_based',
    basis: f + ' kg CO2e per $ for ' + req.catName + ' (EPA USEEIO v1.3)',
    pcf: null
  };
}

/** Which rung of the proximity ladder an inventory line sits on, relative to the request. */
function _proximity(req, item, ctx) {
  if (item.bldgId && req.bldgId && item.bldgId === req.bldgId) {
    return { rung: 'same_building', meters: 0, note: 'Already in ' + req.bldgName + ' - no transport at all.' };
  }
  var rb = ctx.bldg['#' + req.bldgId], ib = ctx.bldg['#' + item.bldgId];
  var d = (rb && ib) ? _meters(rb.lat, rb.lon, ib.lat, ib.lon) : null;
  if (item.deptId && req.deptId && item.deptId === req.deptId) {
    return {
      rung: 'same_department', meters: d === null ? null : _r0(d),
      note: 'Held by the requesting department itself, in ' + item.bldgName + '.'
    };
  }
  if (d !== null && d <= NEARBY_METERS) {
    return { rung: 'nearby', meters: _r0(d), note: _r0(d) + ' m away in ' + item.bldgName + ' - a short walk.' };
  }
  return {
    rung: 'campus', meters: d === null ? null : _r0(d),
    note: 'Elsewhere on campus (' + item.bldgName + ')' + (d === null ? '' : ', ' + _r0(d) + ' m away') + '.'
  };
}

/* ------------------------------------------------------------------ the ladder */

/** Rung 1: surplus stock that already exists. */
function _reuseOptions(req, carbon, ctx) {
  var want = _tokens(req.productName), out = [], i;
  for (i = 0; i < ctx.inv.length; i++) {
    var item = ctx.inv[i];
    if (item.excess <= 0) continue;
    if (item.catId !== req.catId) continue;           // never cross categories - safety and sanity
    var score = _overlap(want, item.tokens);
    var exact = item.tokens.join(' ') === want.join(' ');
    if (!exact && score < 2) continue;                // needs to be recognisably the same thing

    var units = Math.min(req.quantity, item.excess);
    var dollars = units * req.unitPrice;
    var tonnes, method, basis;
    if (carbon.pcf && carbon.pcf.kgCo2e > 0) {
      var share = (carbon.pcf.pctManufacturing === null || carbon.pcf.pctManufacturing <= 0)
        ? 1.0 : carbon.pcf.pctManufacturing;
      tonnes = units * carbon.pcf.kgCo2e * share / 1000.0;
      method = 'product_footprint';
      basis = units + ' x ' + carbon.pcf.kgCo2e + ' kg CO2e x ' + Math.round(share * 100) +
              '% manufacturing share (' + (carbon.pcf.source || 'PCF') + ')';
    } else {
      var f = ctx.factor['#' + req.catId] || 0;
      tonnes = dollars * f / 1000.0;
      method = 'spend_based';
      basis = _usd(dollars) + ' not spent x ' + f + ' kg CO2e/$ for ' + req.catName;
    }

    var prox = _proximity(req, item, ctx);
    out.push({
      action: 'reuse',
      rank: 0,
      proximity: prox.rung,
      proximityRank: RUNG_RANK[prox.rung],
      distanceMeters: prox.meters,
      coversUnits: units,
      coversPct: req.quantity > 0 ? _pct(units, req.quantity) : 0,
      full: units >= req.quantity,
      avoidedTonnes: _r3(tonnes),
      avoidedUsd: _r0(dollars),
      method: method,
      basis: basis,
      sourceInventoryId: item.id,
      sourceProductName: item.productName,
      sourceDepartmentId: item.deptId,
      sourceDepartmentName: item.deptName,
      sourceBuildingId: item.bldgId,
      sourceBuildingName: item.bldgName,
      unitsAvailable: item.excess,
      unitLabel: item.unitLabel,
      ownerNotes: item.notes,
      message: (units >= req.quantity ? ('All ' + req.quantity) : (units + ' of the ' + req.quantity)) +
               ' requested ' + _units(item.unitLabel, units) + ' are already on hand as surplus with ' +
               item.deptName + ' (' + item.excess + ' spare). ' + prox.note +
               ' Claiming them avoids ' + _r3(tonnes) + ' tCO2e and ' + _usd(dollars) + '.'
    });
  }
  out.sort(function (a, b) {
    if (a.proximityRank !== b.proximityRank) return a.proximityRank - b.proximityRank;
    if (b.coversUnits !== a.coversUnits) return b.coversUnits - a.coversUnits;
    return b.avoidedTonnes - a.avoidedTonnes;
  });
  for (i = 0; i < out.length; i++) out[i].rank = i + 1;
  return out;
}

/**
 * Why rung 1 came back empty, read off the inventory that was actually searched.
 *
 * "No suggestions" is the least useful thing an advisory agent can say, and the reason matters to
 * a different person each time: nothing declared surplus is a policy gap, everything committed is
 * a capacity problem, and a near-miss on the name is a catalogue problem. Derived from the same
 * loop {@link _reuseOptions} runs rather than from a table of per-category excuses, so the
 * sentence changes when the data does.
 */
function _reuseGap(req, ctx) {
  var want = _tokens(req.productName), sameCat = 0, spare = 0, closest = null, best = -1, i;
  for (i = 0; i < ctx.inv.length; i++) {
    var item = ctx.inv[i];
    if (item.catId !== req.catId) continue;
    sameCat++;
    if (item.excess <= 0) continue;
    spare++;
    var score = _overlap(want, item.tokens);
    if (score > best) { best = score; closest = item; }
  }
  if (sameCat === 0) {
    return 'No department has declared any surplus in ' + req.catName +
           ', so there is nothing on campus to claim instead of buying.';
  }
  if (spare === 0) {
    return sameCat + ' ' + req.catName + ' line' + (sameCat === 1 ? ' is' : 's are') +
           ' tracked on campus, but every one is fully committed. On hand is not the same as spare.';
  }
  return spare + ' ' + req.catName + ' surplus line' + (spare === 1 ? '' : 's') + ' exist' +
         (spare === 1 ? 's' : '') + ' - the closest is ' + closest.productName + ' held by ' +
         closest.deptName + ' - but none is recognisably the same item as ' + req.productName +
         '. The intercept will not propose a half-match on a consumable.';
}

/**
 * Rung 2: an existing contract line that meets the same need with less carbon. Only proposed
 * on evidence - a circular-economy signal in the line, or a footprint showing it is lower.
 */
function _substituteOptions(req, carbon, ctx, units) {
  var want = _tokens(req.productName), out = [], i;
  var n = units === undefined ? req.quantity : units;
  if (n <= 0) return out;

  for (i = 0; i < ctx.contracts.length; i++) {
    var ct = ctx.contracts[i];
    if (ct.unitPrice >= req.unitPrice) continue;                 // not a cheaper way to meet the need
    if (_overlap(want, ct.tokens) < 2) continue;                 // not the same kind of thing
    if (req.vendorId && ct.vendorId && ct.vendorId !== req.vendorId) continue; // stay on a usable contract

    var subPcf = _matchPcf(ct.productName, ctx);
    var lowerByPcf = !!(subPcf && carbon.pcf && subPcf.id !== carbon.pcf.id && subPcf.kgCo2e < carbon.pcf.kgCo2e);
    if (!ct.circular && !lowerByPcf) continue;                   // no evidence it is actually cleaner

    var dollars = n * (req.unitPrice - ct.unitPrice);
    var tonnes, method, basis;
    if (lowerByPcf) {
      tonnes = n * (carbon.pcf.kgCo2e - subPcf.kgCo2e) / 1000.0;
      method = 'product_footprint';
      basis = n + ' x (' + carbon.pcf.kgCo2e + ' - ' + subPcf.kgCo2e + ') kg CO2e/unit (' +
              (subPcf.source || 'PCF') + ')';
    } else {
      var f = ctx.factor['#' + req.catId] || 0;
      tonnes = dollars * f / 1000.0;
      method = 'spend_based';
      basis = _usd(dollars) + ' less spend x ' + f + ' kg CO2e/$ for ' + req.catName;
    }

    out.push({
      action: 'substitute',
      rank: 0,
      coversUnits: n,
      coversPct: req.quantity > 0 ? _pct(n, req.quantity) : 0,
      avoidedTonnes: _r3(tonnes),
      avoidedUsd: _r0(dollars),
      method: method,
      basis: basis,
      contractId: ct.id,
      contractProductName: ct.productName,
      contractUnitPrice: ct.unitPrice,
      requestUnitPrice: req.unitPrice,
      unitPriceDeltaPct: req.unitPrice > 0 ? _pct(req.unitPrice - ct.unitPrice, req.unitPrice) : 0,
      vendorId: ct.vendorId,
      vendorName: ct.vendorName,
      evidence: lowerByPcf
        ? ('Published footprint: ' + subPcf.kgCo2e + ' vs ' + carbon.pcf.kgCo2e + ' kg CO2e per unit.')
        : 'Contract line is a circular / refurbished option on an existing agreement.',
      message: 'Buy ' + n + ' on ' + ct.productName + ' (' + _usd(ct.unitPrice) + '/unit) instead of ' +
               _usd(req.unitPrice) + '/unit. Same need met, ' + _usd(dollars) + ' and ' +
               _r3(tonnes) + ' tCO2e avoided, on a contract that already exists.'
    });
  }
  out.sort(function (a, b) { return b.avoidedTonnes - a.avoidedTonnes; });
  for (i = 0; i < out.length; i++) out[i].rank = i + 1;
  return out;
}

/** Rung 3: other pending requests for the same category heading to the same building. */
function _consolidateOption(req, ctx) {
  var peers = [], combined = req.amount, i;
  for (i = 0; i < ctx.pending.length; i++) {
    var p = ctx.pending[i];
    if (p.id === req.id) continue;
    if (p.bldgId !== req.bldgId || p.catId !== req.catId) continue;
    peers.push({
      id: p.id, productName: p.productName, departmentName: p.deptName,
      quantity: p.quantity, amount: _r0(p.amount), requestedBy: p.requestedBy,
      vendorName: p.vendorName
    });
    combined += p.amount;
  }
  if (peers.length === 0) return null;

  var shipF = ctx.factor['#shipping'] || 0;
  var tonnes = combined * SHIPPING_SHARE_OF_ORDER * shipF / 1000.0 * (peers.length / (peers.length + 1.0));
  return {
    action: 'consolidate',
    rank: 1,
    coversUnits: req.quantity,
    coversPct: 100,
    avoidedTonnes: _r3(tonnes),
    avoidedUsd: 0,
    method: 'estimated_logistics',
    basis: 'Freight assumed at ' + Math.round(SHIPPING_SHARE_OF_ORDER * 100) + '% of ' + _usd(combined) +
           ' combined order value x ' + shipF + ' kg CO2e/$ for shipping, scaled by the ' +
           peers.length + ' of ' + (peers.length + 1) + ' deliveries removed.',
    ordersAvoided: peers.length,
    combinedUsd: _r0(combined),
    peers: peers,
    message: peers.length + ' other pending ' + req.catName + ' request' + (peers.length === 1 ? '' : 's') +
             ' are already heading to ' + req.bldgName + ' (' + _usd(combined) +
             ' combined). One order and one delivery instead of ' + (peers.length + 1) + '.'
  };
}

/** Rung 4: the May/June fiscal-year-end rush, where a measurable share of spend goes unused. */
function _deferOption(req, carbon, ctx) {
  if (req.month !== 5 && req.month !== 6) return null;
  // "Use it or lose it" is about buying extra units of something you already consume. A single
  // capital item with a stated need is not over-ordering, and telling someone to defer their one
  // clinical centrifuge would discredit every other suggestion the agent makes.
  if (req.quantity < 2) return null;
  var share = ctx.yearEnd.excessShare;
  if (share <= 0) return null;
  return {
    action: 'defer',
    rank: 1,
    coversUnits: req.quantity,
    coversPct: 100,
    avoidedTonnes: _r3(carbon.tonnes * share),
    avoidedUsd: _r0(req.amount * share),
    method: 'year_end_excess_share',
    basis: 'May+June FY' + ctx.yearEnd.fiscalYear + ' spend runs ' + ctx.yearEnd.juneMultiple +
           'x a normal month; ' + _pct(share, 1) + '% of that rush sits above baseline demand.',
    riskSharePct: _pct(share, 1),
    message: 'This request lands in the fiscal-year-end window (month ' + req.month +
             '). Campus May/June ordering runs ' + ctx.yearEnd.juneMultiple +
             'x a normal month, so roughly ' + _pct(share, 1) +
             '% of it is above real demand. Deferring into the new fiscal year, when the need is ' +
             'confirmed, is worth about ' + _r3(carbon.tonnes * share) + ' tCO2e and ' +
             _usd(req.amount * share) + ' at risk here.',
    caveat: 'Deferral only avoids emissions if the need turns out to be smaller than feared; ' +
            'it is an over-ordering risk estimate, not a booked saving.'
  };
}

/** Evaluate one request against the whole ladder and stack the rungs into a recommendation. */
function _evaluate(req, ctx) {
  var carbon = _requestCarbon(req, ctx);
  var reuse = _reuseOptions(req, carbon, ctx);
  var consolidate = _consolidateOption(req, ctx);
  var defer = _deferOption(req, carbon, ctx);

  var bestReuse = reuse.length > 0 ? reuse[0] : null;
  var covered = bestReuse ? bestReuse.coversUnits : 0;
  var remaining = req.quantity - covered;

  // Standalone substitution (the whole request) for the options list, and the stacked version
  // (only the units reuse could not cover) for the recommendation.
  var substitute = _substituteOptions(req, carbon, ctx, req.quantity);
  var substituteRemainder = remaining > 0 && remaining < req.quantity
    ? _substituteOptions(req, carbon, ctx, remaining)
    : substitute;
  var bestSub = substituteRemainder.length > 0 ? substituteRemainder[0] : null;

  var options = [];
  for (var i = 0; i < reuse.length; i++) options.push(reuse[i]);
  for (var j = 0; j < substitute.length; j++) options.push(substitute[j]);
  if (consolidate) options.push(consolidate);
  if (defer) options.push(defer);

  // Stacked plan: reuse what exists, substitute the rest, then consolidate whatever still ships.
  var steps = [], avoidT = 0, avoidUsd = 0;
  if (bestReuse) {
    steps.push({
      order: steps.length + 1, action: 'reuse', units: bestReuse.coversUnits,
      avoidedTonnes: bestReuse.avoidedTonnes, avoidedUsd: bestReuse.avoidedUsd,
      detail: bestReuse.message
    });
    avoidT += bestReuse.avoidedTonnes;
    avoidUsd += bestReuse.avoidedUsd;
  }
  if (bestSub && remaining > 0) {
    steps.push({
      order: steps.length + 1, action: 'substitute', units: bestSub.coversUnits,
      avoidedTonnes: bestSub.avoidedTonnes, avoidedUsd: bestSub.avoidedUsd,
      detail: bestSub.message
    });
    avoidT += bestSub.avoidedTonnes;
    avoidUsd += bestSub.avoidedUsd;
  }
  if (consolidate && remaining > 0) {
    steps.push({
      order: steps.length + 1, action: 'consolidate', units: remaining,
      avoidedTonnes: consolidate.avoidedTonnes, avoidedUsd: consolidate.avoidedUsd,
      detail: consolidate.message
    });
    avoidT += consolidate.avoidedTonnes;
    avoidUsd += consolidate.avoidedUsd;
  }
  // Deferral is the last rung and the weakest claim, so it is only advised when nothing on the
  // ladder above it applies. Where surplus stock or a cleaner contract line exists, that is the
  // better answer and deferring on top of it would double-count the same avoided units.
  if (steps.length === 0 && defer) {
    steps.push({
      order: 1, action: 'defer', units: req.quantity,
      avoidedTonnes: defer.avoidedTonnes, avoidedUsd: defer.avoidedUsd,
      detail: defer.message
    });
    avoidT += defer.avoidedTonnes;
    avoidUsd += defer.avoidedUsd;
  }

  var topAction = steps.length > 0 ? steps[0].action : 'proceed';
  var estT = _r3(carbon.tonnes);
  var residual = estT - avoidT;
  if (residual < 0) residual = 0;

  return {
    request: {
      id: req.id, productName: req.productName, categoryId: req.catId, categoryName: req.catName,
      departmentId: req.deptId, departmentName: req.deptName,
      buildingId: req.bldgId, buildingName: req.bldgName,
      vendorId: req.vendorId, vendorName: req.vendorName,
      quantity: req.quantity, unitPrice: req.unitPrice, amount: _r0(req.amount),
      requestedBy: req.requestedBy, requestDate: req.requestDate, month: req.month,
      status: req.status, justification: req.justification
    },
    estimated: {
      tonnes: estT,
      method: carbon.method,
      basis: carbon.basis,
      footprintId: carbon.pcf ? carbon.pcf.id : null
    },
    options: options,
    optionCount: options.length,
    reuse: reuse,
    reuseGap: reuse.length === 0 ? _reuseGap(req, ctx) : null,
    substitute: substitute,
    consolidate: consolidate,
    defer: defer,
    recommendation: {
      topAction: topAction,
      steps: steps,
      avoidedTonnes: _r3(avoidT),
      avoidedUsd: _r0(avoidUsd),
      // Share of this request's own carbon, capped at 100: the per-step tonnes are rounded for
      // display and their sum can otherwise tip a whole-request match to 100.6%.
      avoidedPct: estT > 0 ? Math.min(100, _pct(avoidT, estT)) : 0,
      residualTonnes: _r3(residual),
      unitsStillOrdered: remaining,
      summary: steps.length === 0
        ? ('No surplus stock, lower-carbon contract line or consolidation partner found for ' +
           req.productName + '. Proceed with the order - its ' + estT +
           ' tCO2e is unavoidable demand, which is worth knowing.')
        : (steps.length + ' step' + (steps.length === 1 ? '' : 's') + ' avoid ' + _r3(avoidT) +
           ' tCO2e (' + Math.min(100, _pct(avoidT, estT)) + '% of this request) and ' + _usd(avoidUsd) +
           '. The intercept suggests - the requester decides.')
    }
  };
}

/** Trim a full evaluation down to a queue row. */
function _queueRow(ev) {
  var rec = ev.recommendation;
  var best = ev.reuse.length > 0 ? ev.reuse[0] : null;
  return {
    requestId: ev.request.id,
    productName: ev.request.productName,
    categoryId: ev.request.categoryId,
    categoryName: ev.request.categoryName,
    departmentName: ev.request.departmentName,
    buildingName: ev.request.buildingName,
    vendorName: ev.request.vendorName,
    quantity: ev.request.quantity,
    amount: ev.request.amount,
    requestedBy: ev.request.requestedBy,
    requestDate: ev.request.requestDate,
    status: ev.request.status,
    estimatedTonnes: ev.estimated.tonnes,
    carbonMethod: ev.estimated.method,
    topAction: rec.topAction,
    optionCount: ev.optionCount,
    avoidedTonnes: rec.avoidedTonnes,
    avoidedUsd: rec.avoidedUsd,
    avoidedPct: rec.avoidedPct,
    residualTonnes: rec.residualTonnes,
    reuseProximity: best ? best.proximity : null,
    reuseDistanceMeters: best ? best.distanceMeters : null,
    reuseSourceDepartment: best ? best.sourceDepartmentName : null,
    reuseCoversPct: best ? best.coversPct : 0,
    hasSubstitute: ev.substitute.length > 0,
    hasConsolidation: !!ev.consolidate,
    yearEndFlag: !!ev.defer,
    headline: rec.summary
  };
}

/* ------------------------------------------------------------------ public methods */

function queue(status, limit) {
  var want = (status === null || status === undefined || status === '') ? 'all' : status;
  var lim = limit || 50;
  var ctx = _ctx(BASELINE_FY);

  var spec = { include: REQ_INCLUDE, limit: -1 };
  if (want !== 'all') spec.filter = Filter.eq('status', want);
  var rows = _toArr(PurchaseRequest.fetch(spec).objs);

  var evals = [], i;
  for (i = 0; i < rows.length; i++) evals.push(_evaluate(_flatReq(rows[i]), ctx));
  evals.sort(function (a, b) {
    if (b.recommendation.avoidedTonnes !== a.recommendation.avoidedTonnes) {
      return b.recommendation.avoidedTonnes - a.recommendation.avoidedTonnes;
    }
    return b.estimated.tonnes - a.estimated.tonnes;
  });

  var out = [], totT = 0, totUsd = 0, avoidT = 0, avoidUsd = 0, withOpp = 0;
  for (i = 0; i < evals.length; i++) {
    totT += evals[i].estimated.tonnes;
    totUsd += evals[i].request.amount;
    avoidT += evals[i].recommendation.avoidedTonnes;
    avoidUsd += evals[i].recommendation.avoidedUsd;
    if (evals[i].recommendation.topAction !== 'proceed') withOpp += 1;
    if (i < lim) out.push(_queueRow(evals[i]));
  }

  return {
    status: want,
    requestCount: evals.length,
    returned: out.length,
    totalValueUsd: _r0(totUsd),
    totalEstimatedTonnes: _r3(totT),
    requestsWithOpportunity: withOpp,
    opportunityRatePct: evals.length > 0 ? _pct(withOpp, evals.length) : 0,
    avoidableTonnes: _r3(avoidT),
    avoidableUsd: _r0(avoidUsd),
    avoidablePct: totT > 0 ? _pct(avoidT, totT) : 0,
    nearbyMeters: NEARBY_METERS,
    rows: out
  };
}

function evaluate(requestId) {
  var rows = _toArr(PurchaseRequest.fetch({
    filter: Filter.eq('id', requestId), include: REQ_INCLUDE, limit: 1
  }).objs);
  if (rows.length === 0) throw 'No PurchaseRequest with id "' + requestId + '".';
  var ctx = _ctx(BASELINE_FY);
  var ev = _evaluate(_flatReq(rows[0]), ctx);
  ev.nearbyMeters = NEARBY_METERS;
  ev.yearEndContext = {
    fiscalYear: ctx.yearEnd.fiscalYear,
    juneMultiple: ctx.yearEnd.juneMultiple,
    excessSharePct: _pct(ctx.yearEnd.excessShare, 1)
  };
  return ev;
}

function decide(requestId, action, reason) {
  var act = String(action || '').toLowerCase();
  var newStatus = _statusForAction(act);
  if (!newStatus) {
    throw 'Unknown action "' + action + '". Expected one of: reuse, substitute, consolidate, ' +
          'approve, decline, reset.';
  }

  var rows = _toArr(PurchaseRequest.fetch({
    filter: Filter.eq('id', requestId), include: REQ_INCLUDE, limit: 1
  }).objs);
  if (rows.length === 0) throw 'No PurchaseRequest with id "' + requestId + '".';

  var ctx = _ctx(BASELINE_FY);
  var ev = _evaluate(_flatReq(rows[0]), ctx);

  // Credit only the rung actually taken, from a fresh evaluation rather than caller-supplied numbers.
  var realisedT = 0, realisedUsd = 0, taken = null;
  if (act === 'reuse' && ev.reuse.length > 0) taken = ev.reuse[0];
  else if (act === 'substitute' && ev.substitute.length > 0) taken = ev.substitute[0];
  else if (act === 'consolidate' && ev.consolidate) taken = ev.consolidate;
  if (taken) { realisedT = taken.avoidedTonnes; realisedUsd = taken.avoidedUsd; }

  // The trail is appended, never rewound - including on `reset`. A procurement record should show
  // that a decision was taken and then withdrawn; silently restoring the original justification
  // would erase the more interesting half of the history.
  var prior = rows[0].justification ? String(rows[0].justification) : '';
  var stamp = '[' + newStatus + '] ' + (reason ? reason
    : (act === 'reset' ? 'Decision withdrawn; request returned to the queue.' : 'No reason given.'));
  var note = prior.length > 0 ? (prior + ' ' + stamp) : stamp;

  // merge() is a member action, so build the partial object and merge it: a partial write that
  // leaves quantity, vendor, dates and the rest of the request untouched.
  PurchaseRequest.make({ id: requestId, status: newStatus, justification: note }).merge();

  return {
    requestId: requestId,
    action: act,
    status: newStatus,
    reason: reason || null,
    accepted: act === 'reuse' || act === 'substitute' || act === 'consolidate',
    realisedTonnes: _r3(realisedT),
    realisedUsd: _r0(realisedUsd),
    counterparty: taken
      ? (taken.action === 'reuse' ? taken.sourceDepartmentName
        : (taken.action === 'substitute' ? taken.contractProductName : (taken.ordersAvoided + ' peer requests')))
      : null,
    residualTonnes: _r3(Math.max(0, ev.estimated.tonnes - realisedT)),
    justification: note,
    barrierSignal: (act === 'approve' || act === 'decline') && ev.optionCount > 0
      ? {
          note: 'A suggestion existed and was not taken. This is barrier-to-reuse evidence, not a failure.',
          forgoneTonnes: ev.recommendation.avoidedTonnes,
          forgoneUsd: ev.recommendation.avoidedUsd,
          reason: reason || null
        }
      : null
  };
}

function interceptStats(fiscalYear) {
  var fy = fiscalYear || BASELINE_FY;
  var ctx = _ctx(fy);
  var rows = _toArr(PurchaseRequest.fetch({ include: REQ_INCLUDE, limit: -1 }).objs);

  var totT = 0, totUsd = 0, avoidT = 0, avoidUsd = 0;
  var byAction = { reuse: 0, substitute: 0, consolidate: 0, defer: 0, proceed: 0 };
  var byProximity = { same_building: 0, same_department: 0, nearby: 0, campus: 0, none: 0 };
  var byStatus = {}, declines = [], partials = [], topOpps = [], i;
  var realT = 0, realUsd = 0, acceptedCount = 0, pendingCount = 0;

  for (i = 0; i < rows.length; i++) {
    var req = _flatReq(rows[i]);
    var ev = _evaluate(req, ctx);
    var rec = ev.recommendation;

    totT += ev.estimated.tonnes;
    totUsd += ev.request.amount;
    avoidT += rec.avoidedTonnes;
    avoidUsd += rec.avoidedUsd;

    byAction[rec.topAction] = (byAction[rec.topAction] || 0) + 1;
    var best = ev.reuse.length > 0 ? ev.reuse[0] : null;
    byProximity[best ? best.proximity : 'none'] += 1;
    byStatus['#' + req.status] = (byStatus['#' + req.status] || 0) + 1;

    if (best && !best.full) {
      partials.push({
        requestId: req.id, productName: req.productName,
        requestedUnits: req.quantity, availableUnits: best.coversUnits,
        coversPct: best.coversPct, sourceDepartmentName: best.sourceDepartmentName,
        note: 'Surplus covers part of the request; the balance still needs buying.'
      });
    }
    if (rec.topAction !== 'proceed') {
      topOpps.push({
        requestId: req.id, productName: req.productName, categoryName: req.catName,
        departmentName: req.deptName, topAction: rec.topAction,
        avoidedTonnes: rec.avoidedTonnes, avoidedUsd: rec.avoidedUsd
      });
    }
    // What the decisions already recorded are actually worth. Re-derived from the current ladder
    // using the same rung {@link InterceptAgent#decide} credited, rather than stored on the
    // request: if the surplus that justified a reuse decision is gone, the credit goes with it.
    // Keeping this server-side means the figure survives a page reload, which a running total
    // accumulated in a browser session does not.
    if (req.status === 'Pending') pendingCount++;
    var credited = null;
    if (req.status === 'Reused' && ev.reuse.length > 0) credited = ev.reuse[0];
    else if (req.status === 'Substituted' && ev.substitute.length > 0) credited = ev.substitute[0];
    else if (req.status === 'Consolidated' && ev.consolidate) credited = ev.consolidate;
    if (credited) {
      realT += credited.avoidedTonnes;
      realUsd += credited.avoidedUsd;
      acceptedCount++;
    }
    if (req.status === 'Declined' || req.status === 'Approved') {
      if (ev.optionCount > 0) {
        declines.push({
          requestId: req.id, productName: req.productName, status: req.status,
          forgoneTonnes: rec.avoidedTonnes, forgoneUsd: rec.avoidedUsd,
          reason: req.justification
        });
      }
    }
  }
  topOpps.sort(function (a, b) { return b.avoidedTonnes - a.avoidedTonnes; });

  // Close the loop to Agent 3: what is this stack of decisions worth against the 2030 goal?
  var goalRows = _toArr(SustainabilityGoal.fetch({
    filter: Filter.eq('targetYear', 2030), include: 'id, name, targetYear, reductionPct', limit: 1
  }).objs);
  var goal = null;
  if (goalRows.length > 0 && ctx.yearEnd.campusTonnes > 0) {
    var gapT = ctx.yearEnd.campusTonnes * goalRows[0].reductionPct;
    goal = {
      id: goalRows[0].id,
      name: goalRows[0].name,
      targetYear: goalRows[0].targetYear,
      reductionPct: _r1(goalRows[0].reductionPct * 100),
      gapTonnes: _r1(gapT),
      interceptSharePct: gapT > 0 ? _pct(avoidT, gapT) : 0,
      note: 'One queue of ' + rows.length + ' requests is a single month of one slice of campus ' +
            'purchasing. The share of the 2030 gap it closes is small by construction - the point ' +
            'is that it is non-zero, attributable, and repeats every month.'
    };
  }

  var statusCounts = [];
  for (var k in byStatus) statusCounts.push({ status: k.substring(1), count: byStatus[k] });

  return {
    fiscalYear: fy,
    requestCount: rows.length,
    totalValueUsd: _r0(totUsd),
    totalEstimatedTonnes: _r3(totT),
    avoidableTonnes: _r3(avoidT),
    avoidableUsd: _r0(avoidUsd),
    avoidablePct: totT > 0 ? _pct(avoidT, totT) : 0,
    realised: {
      pendingCount: pendingCount,
      decidedCount: rows.length - pendingCount,
      acceptedCount: acceptedCount,
      tonnes: _r3(realT),
      usd: _r0(realUsd),
      shareOfAvoidablePct: avoidT > 0 ? _pct(realT, avoidT) : 0,
      note: acceptedCount === 0
        ? 'Nothing has been accepted yet, so nothing is credited. The avoidable figure beside this is an offer, not an achievement.'
        : (acceptedCount + ' accepted suggestion' + (acceptedCount === 1 ? ' accounts' : 's account') +
           ' for ' + _r3(realT) + ' tCO2e of the ' + _r3(avoidT) + ' tCO2e on the table.')
    },
    topActionMix: byAction,
    reuseProximityMix: byProximity,
    nearbyMeters: NEARBY_METERS,
    partialMatches: partials,
    topOpportunities: topOpps,
    statusCounts: statusCounts,
    decisionsAgainstAdvice: declines,
    campusContext: {
      fiscalYear: ctx.yearEnd.fiscalYear,
      campusTonnes: _r1(ctx.yearEnd.campusTonnes),
      campusSpendUsd: _r0(ctx.yearEnd.campusSpend),
      queueShareOfCampusTonnesPct: ctx.yearEnd.campusTonnes > 0 ? _pct(totT, ctx.yearEnd.campusTonnes) : 0,
      juneMultiple: ctx.yearEnd.juneMultiple,
      yearEndExcessSharePct: _pct(ctx.yearEnd.excessShare, 1)
    },
    goal: goal,
    interpretation: 'Agent 1 says where the carbon is and Agent 3 says how much has to go. This ' +
                    'agent is the only one that touches an actual decision: ' + _r3(avoidT) +
                    ' tCO2e and ' + _usd(avoidUsd) + ' avoidable across ' + rows.length +
                    ' requests, found by looking at stock that already exists before ordering more.'
  };
}
