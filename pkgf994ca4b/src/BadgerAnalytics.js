/*
 * Agent 1 implementation. See BadgerAnalytics.c3typ for the method contracts.
 *
 * Shared conventions in this file:
 *  - BASELINE_FY is the planner's baseline year and the default for every method.
 *  - _toArr() normalises C3 collections into native JS arrays, because C3 Arrays do not
 *    support sort() and only sometimes support forEach()/index access.
 *  - _loadTxns() is the single join used by every rollup: spend -> category -> EPA factor.
 */

var BASELINE_FY = 2024;

/** Copy a C3 collection (or native array) into a plain JS array so it can be sorted. */
function _toArr(coll) {
  var out = [];
  if (!coll) return out;
  var n = coll.length;
  for (var i = 0; i < n; i++) {
    out.push(coll.get ? coll.get(i) : coll[i]);
  }
  return out;
}

function _round1(x) { return Math.round(x * 10) / 10; }
function _round0(x) { return Math.round(x); }
function _pct(part, whole) { return whole > 0 ? Math.round(part / whole * 1000) / 10 : 0; }

/** Count an object's own keys without relying on Object.keys (absent in some Rhino builds). */
function _countKeys(obj) {
  var n = 0;
  for (var k in obj) n++;
  return n;
}

/**
 * Load spend transactions with everything needed to compute and attribute carbon. Returns
 * native JS objects, each pre-decorated with its tonnes. Pass a null `fy` to load every year
 * in one fetch, which is what the trend chart does instead of one fetch per year.
 */
function _loadTxns(fy) {
  var spec = {
    include: 'id, amount, fiscalYear, transactionDate, ' +
             'productCategory.id, productCategory.name, ' +
             'productCategory.emissionFactor.kgCo2ePerDollar, ' +
             'department.id, department.name, department.college, ' +
             'department.building.id, department.building.name, ' +
             'vendor.id, vendor.name',
    limit: -1
  };
  if (fy !== null && fy !== undefined) spec.filter = Filter.eq('fiscalYear', fy);
  var raw = _toArr(SpendTransaction.fetch(spec).objs);

  var out = [];
  for (var i = 0; i < raw.length; i++) {
    var t = raw[i];
    var ef = (t.productCategory && t.productCategory.emissionFactor)
      ? t.productCategory.emissionFactor.kgCo2ePerDollar : 0;
    out.push({
      id: t.id,
      amount: t.amount,
      fy: t.fiscalYear,
      tonnes: t.amount * ef / 1000.0,
      month: t.transactionDate ? parseInt(String(t.transactionDate).substring(5, 7), 10) : 0,
      catId: t.productCategory ? t.productCategory.id : 'unclassified',
      catName: t.productCategory ? t.productCategory.name : 'Unclassified',
      deptId: t.department ? t.department.id : 'unattributed',
      deptName: t.department ? t.department.name : 'Unattributed',
      college: (t.department && t.department.college) ? t.department.college : 'Unknown',
      bldgId: (t.department && t.department.building) ? t.department.building.id : 'unknown',
      bldgName: (t.department && t.department.building) ? t.department.building.name : 'Unknown',
      vendorId: t.vendor ? t.vendor.id : 'unknown',
      vendorName: t.vendor ? t.vendor.name : 'Unknown'
    });
  }
  return out;
}

/** Group pre-decorated transactions by a key function, summing tonnes and spend. */
function _groupBy(txns, keyFn, labelFn) {
  var map = {}, order = [];
  for (var i = 0; i < txns.length; i++) {
    var k = keyFn(txns[i]);
    if (!map[k]) {
      map[k] = { key: k, label: labelFn(txns[i]), tonnes: 0, spend: 0, count: 0 };
      order.push(k);
    }
    map[k].tonnes += txns[i].tonnes;
    map[k].spend += txns[i].amount;
    map[k].count += 1;
  }
  var rows = [];
  for (var j = 0; j < order.length; j++) rows.push(map[order[j]]);
  rows.sort(function (a, b) { return b.tonnes - a.tonnes; });
  return rows;
}

/** Resolve a dimension name to (keyFn, labelFn). Returns null for an unknown dimension. */
function _dimAccessors(dimension) {
  switch (dimension) {
    case 'category':   return { k: function (t) { return t.catId; },    l: function (t) { return t.catName; } };
    case 'department': return { k: function (t) { return t.deptId; },   l: function (t) { return t.deptName; } };
    case 'building':   return { k: function (t) { return t.bldgId; },   l: function (t) { return t.bldgName; } };
    case 'college':    return { k: function (t) { return t.college; },  l: function (t) { return t.college; } };
    case 'vendor':     return { k: function (t) { return t.vendorId; }, l: function (t) { return t.vendorName; } };
    default: return null;
  }
}

function campusSummary(fiscalYear) {
  var fy = fiscalYear || BASELINE_FY;
  var txns = _loadTxns(fy);

  var totalT = 0, totalUsd = 0, monthUsd = {};
  var depts = {}, bldgs = {};
  for (var i = 0; i < txns.length; i++) {
    var t = txns[i];
    totalT += t.tonnes;
    totalUsd += t.amount;
    monthUsd[t.month] = (monthUsd[t.month] || 0) + t.amount;
    depts[t.deptId] = true;
    bldgs[t.bldgId] = true;
  }

  // Prior-year comparison.
  var prior = _loadTxns(fy - 1);
  var priorT = 0;
  for (var p = 0; p < prior.length; p++) priorT += prior[p].tonnes;

  // Category concentration — the "a few categories own most of it" finding.
  var cats = _groupBy(txns, function (t) { return t.catId; }, function (t) { return t.catName; });
  var top = [];
  var top3T = 0;
  for (var c = 0; c < cats.length && c < 5; c++) {
    top.push({
      id: cats[c].key, name: cats[c].label,
      tonnes: _round1(cats[c].tonnes), spend: _round0(cats[c].spend),
      sharePct: _pct(cats[c].tonnes, totalT),
      kgPerDollar: cats[c].spend > 0 ? Math.round(cats[c].tonnes * 1000 / cats[c].spend * 1000) / 1000 : 0
    });
  }
  for (var c3 = 0; c3 < cats.length && c3 < 3; c3++) top3T += cats[c3].tonnes;

  // Goal progress. reductionPct is stored as a fraction; surface it as 0-100.
  var goals = [];
  var gRows = _toArr(SustainabilityGoal.fetch({
    include: 'id, name, targetYear, baselineYear, reductionPct, scope', limit: -1
  }).objs);
  gRows.sort(function (a, b) { return a.targetYear - b.targetYear; });
  for (var g = 0; g < gRows.length; g++) {
    var targetT = totalT * (1 - gRows[g].reductionPct);
    goals.push({
      id: gRows[g].id, name: gRows[g].name, targetYear: gRows[g].targetYear,
      reductionPct: _round1(gRows[g].reductionPct * 100),
      targetTonnes: _round1(targetT),
      gapTonnes: _round1(totalT - targetT),
      scope: gRows[g].scope
    });
  }

  // Fiscal-year-end spike: UW's FY ends June 30, so May (5) and June (6) are the rush months.
  var avgMonthUsd = totalUsd / 12.0;
  var juneUsd = monthUsd[6] || 0, mayUsd = monthUsd[5] || 0;

  return {
    fiscalYear: fy,
    totalTonnes: _round1(totalT),
    totalSpend: _round0(totalUsd),
    kgPerDollar: totalUsd > 0 ? Math.round(totalT * 1000 / totalUsd * 1000) / 1000 : 0,
    transactionCount: txns.length,
    departmentCount: _countKeys(depts),
    buildingCount: _countKeys(bldgs),
    priorYear: {
      fiscalYear: fy - 1,
      totalTonnes: _round1(priorT),
      changeTonnes: _round1(totalT - priorT),
      changePct: priorT > 0 ? _pct(totalT - priorT, priorT) : null
    },
    topCategories: top,
    concentration: {
      top3SharePct: _pct(top3T, totalT),
      categoryCount: cats.length,
      note: 'The three largest categories carry ' + _pct(top3T, totalT) +
            '% of purchase carbon, so reduction effort concentrates there.'
    },
    goals: goals,
    fiscalYearEndSpike: {
      juneSpend: _round0(juneUsd),
      maySpend: _round0(mayUsd),
      averageMonthSpend: _round0(avgMonthUsd),
      juneMultiple: avgMonthUsd > 0 ? Math.round(juneUsd / avgMonthUsd * 10) / 10 : 0,
      note: 'UW fiscal year ends June 30. Year-end "use it or lose it" ordering is a ' +
            'concentrated, addressable source of over-purchasing.'
    }
  };
}

function emissionsBy(dimension, fiscalYear) {
  var dim = dimension || 'category';
  var fy = fiscalYear || BASELINE_FY;
  var acc = _dimAccessors(dim);
  if (!acc) {
    throw 'Unknown dimension "' + dim + '". Expected one of: category, department, building, college, vendor.';
  }

  var txns = _loadTxns(fy);
  var rows = _groupBy(txns, acc.k, acc.l);
  var totalT = 0, totalUsd = 0;
  for (var i = 0; i < rows.length; i++) { totalT += rows[i].tonnes; totalUsd += rows[i].spend; }

  var out = [];
  for (var j = 0; j < rows.length; j++) {
    var r = rows[j];
    out.push({
      rank: j + 1,
      id: r.key,
      name: r.label,
      tonnes: _round1(r.tonnes),
      spend: _round0(r.spend),
      transactionCount: r.count,
      sharePct: _pct(r.tonnes, totalT),
      spendSharePct: _pct(r.spend, totalUsd),
      kgPerDollar: r.spend > 0 ? Math.round(r.tonnes * 1000 / r.spend * 1000) / 1000 : 0
    });
  }
  return {
    dimension: dim,
    fiscalYear: fy,
    totalTonnes: _round1(totalT),
    totalSpend: _round0(totalUsd),
    rows: out
  };
}

function emissionsTrend(dimension, topN) {
  var n = topN || 5;

  var acc = dimension ? _dimAccessors(dimension) : null;
  if (dimension && !acc) {
    throw 'Unknown dimension "' + dimension + '". Expected one of: category, department, building, college.';
  }

  // One fetch for the whole history, bucketed by fiscal year in memory. The fiscal-year range
  // is discovered from the data rather than hard-coded, so adding a year of spend needs no
  // code change here.
  var all = _loadTxns(null);
  var byYear = {}, years = {};
  for (var a = 0; a < all.length; a++) {
    var yk = all[a].fy;
    if (!byYear[yk]) { byYear[yk] = []; years[yk] = true; }
    byYear[yk].push(all[a]);
  }
  var yearList = [];
  for (var k in years) yearList.push(parseInt(k, 10));
  yearList.sort(function (a2, b2) { return a2 - b2; });

  // Pass 1: campus totals per year, and (if splitting) cumulative size per member.
  var totals = [], perYearRows = {}, memberTotals = {}, memberLabels = {};
  for (var i = 0; i < yearList.length; i++) {
    var fy = yearList[i];
    var txns = byYear[fy] || [];
    var tT = 0, tUsd = 0;
    for (var t = 0; t < txns.length; t++) { tT += txns[t].tonnes; tUsd += txns[t].amount; }
    totals.push({ fiscalYear: fy, tonnes: _round1(tT), spend: _round0(tUsd) });

    if (acc) {
      var rows = _groupBy(txns, acc.k, acc.l);
      perYearRows[fy] = rows;
      for (var r = 0; r < rows.length; r++) {
        memberTotals[rows[r].key] = (memberTotals[rows[r].key] || 0) + rows[r].tonnes;
        memberLabels[rows[r].key] = rows[r].label;
      }
    }
  }

  var result = {
    dimension: dimension || null,
    fiscalYears: yearList,
    campusTotal: totals
  };
  if (!acc) return result;

  // Keep the topN members by total tonnes across all years; fold the rest into "Other".
  var members = [];
  for (var m in memberTotals) members.push({ key: m, tonnes: memberTotals[m] });
  members.sort(function (a, b) { return b.tonnes - a.tonnes; });
  var keep = {};
  for (var s = 0; s < members.length && s < n; s++) keep[members[s].key] = true;

  var series = [], otherPts = {};
  for (var s2 = 0; s2 < members.length && s2 < n; s2++) {
    var key = members[s2].key, pts = [];
    for (var yi = 0; yi < yearList.length; yi++) {
      var rowsY = perYearRows[yearList[yi]], v = 0;
      for (var rr = 0; rr < rowsY.length; rr++) if (rowsY[rr].key === key) v = rowsY[rr].tonnes;
      pts.push({ fiscalYear: yearList[yi], tonnes: _round1(v) });
    }
    series.push({ id: key, name: memberLabels[key], points: pts });
  }
  var hasOther = false;
  for (var yi2 = 0; yi2 < yearList.length; yi2++) {
    var rowsO = perYearRows[yearList[yi2]], ov = 0;
    for (var ro = 0; ro < rowsO.length; ro++) if (!keep[rowsO[ro].key]) { ov += rowsO[ro].tonnes; hasOther = true; }
    otherPts[yearList[yi2]] = ov;
  }
  if (hasOther) {
    var opts = [];
    for (var yi3 = 0; yi3 < yearList.length; yi3++) {
      opts.push({ fiscalYear: yearList[yi3], tonnes: _round1(otherPts[yearList[yi3]]) });
    }
    series.push({ id: 'other', name: 'Other', points: opts });
  }
  result.series = series;
  return result;
}

function hotspots(fiscalYear, limit) {
  var fy = fiscalYear || BASELINE_FY;
  var lim = limit || 10;
  var txns = _loadTxns(fy);

  // Per-category and per-department rollups. The department's own blended intensity is the
  // useful yardstick here: because the EPA factor is per category, every cell in a category has
  // exactly that category's intensity, so comparing a cell against its category average is
  // arithmetically guaranteed to find nothing. Comparing it against everything else the
  // department buys is what tells a chair something they did not know.
  var catT = {}, catUsd = {}, deptT = {}, deptUsd = {}, totalT = 0, totalUsd = 0;
  for (var i = 0; i < txns.length; i++) {
    var t = txns[i];
    catT[t.catId] = (catT[t.catId] || 0) + t.tonnes;
    catUsd[t.catId] = (catUsd[t.catId] || 0) + t.amount;
    deptT[t.deptId] = (deptT[t.deptId] || 0) + t.tonnes;
    deptUsd[t.deptId] = (deptUsd[t.deptId] || 0) + t.amount;
    totalT += t.tonnes;
    totalUsd += t.amount;
  }

  // Which categories actually have a lever available? Drives the "actionable" flag.
  var leverCats = {};
  var lv = _toArr(ReductionLever.fetch({ include: 'productCategory.id, name, horizonYear', limit: -1 }).objs);
  for (var l = 0; l < lv.length; l++) {
    var lc = lv[l].productCategory.id;
    if (!leverCats[lc]) leverCats[lc] = { count: 0, near: 0, firstName: lv[l].name, nearName: null };
    leverCats[lc].count += 1;
    if (lv[l].horizonYear && lv[l].horizonYear <= 2030) {
      leverCats[lc].near += 1;
      // Suggest something the department could start on Monday, not a 2040 capital programme.
      if (!leverCats[lc].nearName) leverCats[lc].nearName = lv[l].name;
    }
  }

  // Department x category cells.
  var cells = {};
  for (var j = 0; j < txns.length; j++) {
    var tx = txns[j], key = tx.deptId + '|' + tx.catId;
    if (!cells[key]) {
      cells[key] = {
        deptId: tx.deptId, deptName: tx.deptName, college: tx.college,
        bldgId: tx.bldgId, bldgName: tx.bldgName,
        catId: tx.catId, catName: tx.catName, tonnes: 0, spend: 0
      };
    }
    cells[key].tonnes += tx.tonnes;
    cells[key].spend += tx.amount;
  }
  var list = [];
  for (var ck in cells) list.push(cells[ck]);
  list.sort(function (a, b) { return b.tonnes - a.tonnes; });

  var out = [];
  for (var x = 0; x < list.length && x < lim; x++) {
    var cl = list[x];
    var cellKg = cl.spend > 0 ? cl.tonnes * 1000 / cl.spend : 0;
    var deptKg = deptUsd[cl.deptId] > 0 ? deptT[cl.deptId] * 1000 / deptUsd[cl.deptId] : 0;
    var carbonShare = _pct(cl.tonnes, deptT[cl.deptId]);
    var spendShare = _pct(cl.spend, deptUsd[cl.deptId]);
    // How much more carbon this cell carries per dollar than the department's average purchase.
    var leverage = spendShare > 0 ? carbonShare / spendShare : 0;
    var lever = leverCats[cl.catId];

    var reasons = [];
    reasons.push(carbonShare + '% of ' + cl.deptName + "'s own footprint");
    reasons.push(_pct(cl.tonnes, catT[cl.catId]) + '% of all campus ' + cl.catName + ' carbon');
    if (leverage >= 1.5) {
      reasons.push('only ' + spendShare + '% of the department\'s spend but ' + carbonShare +
                   '% of its carbon, so a dollar moved here is worth ' +
                   (Math.round(leverage * 10) / 10) + 'x a dollar moved anywhere else it buys');
    }
    if (lever && lever.near === 0) {
      reasons.push('no near-term lever exists for this category - it needs a structural 2040 action');
    }

    out.push({
      rank: x + 1,
      departmentId: cl.deptId, departmentName: cl.deptName, college: cl.college,
      buildingId: cl.bldgId, buildingName: cl.bldgName,
      categoryId: cl.catId, categoryName: cl.catName,
      tonnes: _round1(cl.tonnes),
      spend: _round0(cl.spend),
      campusSharePct: _pct(cl.tonnes, totalT),
      campusSpendSharePct: _pct(cl.spend, totalUsd),
      departmentSharePct: carbonShare,
      departmentSpendSharePct: spendShare,
      categorySharePct: _pct(cl.tonnes, catT[cl.catId]),
      kgPerDollar: Math.round(cellKg * 1000) / 1000,
      departmentAvgKgPerDollar: Math.round(deptKg * 1000) / 1000,
      carbonVsSpendLeverage: Math.round(leverage * 100) / 100,
      actionable: !!lever,
      leverCount: lever ? lever.count : 0,
      nearTermLeverCount: lever ? lever.near : 0,
      suggestedLever: lever ? (lever.nearName || lever.firstName) : null,
      why: reasons.join('; ') + '.'
    });
  }
  return { fiscalYear: fy, totalTonnes: _round1(totalT), totalSpend: _round0(totalUsd), hotspots: out };
}

function buildingMap(fiscalYear) {
  var fy = fiscalYear || BASELINE_FY;
  var txns = _loadTxns(fy);

  var bRows = _toArr(Building.fetch({
    include: 'id, name, latitude, longitude, description', limit: -1
  }).objs);
  var geo = {};
  for (var b = 0; b < bRows.length; b++) {
    geo[bRows[b].id] = bRows[b];
  }

  // '#'-prefixed keys throughout: a category genuinely named "constructor" would
  // otherwise reach Object.prototype and silently corrupt the aggregation.
  var agg = {}, totalT = 0, catName = {}, catTotal = {};
  for (var i = 0; i < txns.length; i++) {
    var t = txns[i];
    if (!agg['#' + t.bldgId]) {
      agg['#' + t.bldgId] = { id: t.bldgId, name: t.bldgName, tonnes: 0, spend: 0, depts: {}, cats: {} };
    }
    var a = agg['#' + t.bldgId];
    a.tonnes += t.tonnes;
    a.spend += t.amount;
    a.depts['#' + t.deptId] = t.deptName;
    a.cats['#' + t.catId] = (a.cats['#' + t.catId] || 0) + t.tonnes;
    catName['#' + t.catId] = t.catName;
    catTotal['#' + t.catId] = (catTotal['#' + t.catId] || 0) + t.tonnes;
    totalT += t.tonnes;
  }

  // The building x category matrix, emitted as cells rather than left to the
  // caller to re-derive. A caller that recomputed it from the raw ledger would be
  // applying the spend-based factor a second time, in a second language, and the
  // two copies would eventually disagree about the same heatmap.
  var cells = [];
  var list = [];
  for (var k in agg) {
    var e = agg[k], g = geo[e.id] || {};
    var topCat = null, topV = -1;
    for (var c in e.cats) {
      if (e.cats[c] > topV) { topV = e.cats[c]; topCat = c; }
      cells.push({
        buildingId: e.id,
        categoryId: c.substring(1),
        tonnes: _round1(e.cats[c]),
        // Share of this building's own footprint: what kind of carbon this is,
        // as distinct from how much. A lever only applies to the kind.
        buildingSharePct: _pct(e.cats[c], e.tonnes),
        // Share of all campus carbon in this category: how much of a single
        // lever's total reach sits at this one address.
        categorySharePct: _pct(e.cats[c], catTotal[c])
      });
    }
    var deptNames = [];
    for (var d in e.depts) deptNames.push(e.depts[d]);
    list.push({
      id: e.id,
      name: g.name || e.name,
      latitude: g.latitude !== undefined ? g.latitude : null,
      longitude: g.longitude !== undefined ? g.longitude : null,
      description: g.description || null,
      tonnes: _round1(e.tonnes),
      spend: _round0(e.spend),
      sharePct: _pct(e.tonnes, totalT),
      kgPerDollar: e.spend > 0 ? Math.round(e.tonnes * 1000 / e.spend * 1000) / 1000 : 0,
      departmentCount: deptNames.length,
      departments: deptNames,
      dominantCategoryId: topCat ? topCat.substring(1) : null,
      dominantCategoryName: topCat ? catName[topCat] : null,
      dominantCategoryTonnes: _round1(topV < 0 ? 0 : topV),
      dominantCategorySharePct: _pct(topV < 0 ? 0 : topV, e.tonnes)
    });
  }
  list.sort(function (a, b) { return b.tonnes - a.tonnes; });

  // Category axis for the matrix, ordered by campus carbon so the heatmap's
  // columns run largest-first without the caller having to sort them.
  var catList = [];
  for (var ck in catTotal) {
    catList.push({ id: ck.substring(1), name: catName[ck], tonnes: _round1(catTotal[ck]) });
  }
  catList.sort(function (x, y) { return y.tonnes - x.tonnes; });

  return {
    fiscalYear: fy,
    totalTonnes: _round1(totalT),
    buildings: list,
    categories: catList,
    matrix: cells,
    interpretation: 'Embodied purchase emissions are released at suppliers, not on campus. ' +
                    'This map shows where the buying decision is made - which is where it can be changed.'
  };
}
