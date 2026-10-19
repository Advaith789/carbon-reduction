/*
 * Agent 4 implementation. See ForecastAgent.c3typ for the method contracts and the model spec.
 *
 * Rhino conventions in this file match the other three agents: `var` only, no arrow functions,
 * no template literals, and C3 collections are copied into native arrays before anything indexes
 * or sorts them.
 *
 * The regression is written out by hand rather than pulled from a library because it has to run
 * inside the Rhino action, and because a thirteen-parameter OLS fit is twenty lines of linear
 * algebra. Everything below the data loading is pure arithmetic with no platform calls, which is
 * also what makes it deterministic: the same ledger always produces the same projection.
 */

var MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
                   'July', 'August', 'September', 'October', 'November', 'December'];

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
function _round2(x) { return Math.round(x * 100) / 100; }

/**
 * Monthly tonnes CO2e per building, as a dense series with explicit zeros.
 *
 * One fetch for the whole ledger, then bucketed in memory. A month in which a building bought
 * nothing is emitted as a genuine 0.0 rather than omitted: skipping it would bias every seasonal
 * coefficient upward, because the months that get skipped are exactly the quiet ones.
 *
 * DateTime has no month() accessor in this runtime, so the year and month come off the ISO string.
 */
function _monthlySeriesByBuilding() {
  var raw = _toArr(SpendTransaction.fetch({
    include: 'id, amount, transactionDate, ' +
             'productCategory.emissionFactor.kgCo2ePerDollar, ' +
             'department.building.id, department.building.name',
    limit: -1
  }).objs);

  // '#'-prefixed keys so a building called "constructor" cannot reach Object.prototype.
  var byBuilding = {};
  var minKey = null;
  var maxKey = null;

  for (var i = 0; i < raw.length; i++) {
    var t = raw[i];
    var b = (t.department && t.department.building) ? t.department.building : null;
    if (!b || !b.id) continue;
    var ef = (t.productCategory && t.productCategory.emissionFactor)
      ? t.productCategory.emissionFactor.kgCo2ePerDollar : 0;
    if (!ef) continue;

    var iso = String(t.transactionDate);
    var year = parseInt(iso.substring(0, 4), 10);
    var month = parseInt(iso.substring(5, 7), 10); // 1-12
    if (!year || !month) continue;
    var absMonth = year * 12 + (month - 1);
    if (minKey === null || absMonth < minKey) minKey = absMonth;
    if (maxKey === null || absMonth > maxKey) maxKey = absMonth;

    var bk = '#' + b.id;
    if (!byBuilding[bk]) byBuilding[bk] = { id: b.id, name: b.name, months: {} };
    var mk = '#' + absMonth;
    if (!byBuilding[bk].months[mk]) byBuilding[bk].months[mk] = 0;
    byBuilding[bk].months[mk] += (t.amount * ef) / 1000;
  }

  // Densify every building over the same window, so the time index means the same thing in
  // every fit and two buildings' projections are directly comparable.
  var out = [];
  for (var key in byBuilding) {
    var rec = byBuilding[key];
    var series = [];
    for (var m = minKey; m <= maxKey; m++) {
      var v = rec.months['#' + m];
      series.push({
        absMonth: m,
        year: Math.floor(m / 12),
        month: (m % 12) + 1,
        tonnes: v ? v : 0
      });
    }
    out.push({ id: rec.id, name: rec.name, series: series });
  }
  return { buildings: out, minAbsMonth: minKey, maxAbsMonth: maxKey };
}

/**
 * Solve (X'X) b = X'y by Gauss-Jordan elimination with partial pivoting.
 *
 * Returns null when the system is singular, which is a real case here: a building that never
 * bought anything in, say, March produces a column of zeros and no unique solution. The caller
 * degrades to a trend-only fit rather than reporting coefficients that do not exist.
 */
function _solveNormalEquations(X, y) {
  var n = X.length;
  if (n === 0) return null;
  var p = X[0].length;

  var A = [];
  for (var r = 0; r < p; r++) {
    var row = [];
    for (var c = 0; c <= p; c++) row.push(0);
    A.push(row);
  }
  for (var i = 0; i < n; i++) {
    for (var a = 0; a < p; a++) {
      for (var b = 0; b < p; b++) A[a][b] += X[i][a] * X[i][b];
      A[a][p] += X[i][a] * y[i];
    }
  }

  for (var col = 0; col < p; col++) {
    var pivotRow = col;
    for (var rr = col + 1; rr < p; rr++) {
      if (Math.abs(A[rr][col]) > Math.abs(A[pivotRow][col])) pivotRow = rr;
    }
    if (Math.abs(A[pivotRow][col]) < 1e-10) return null;
    var tmp = A[col]; A[col] = A[pivotRow]; A[pivotRow] = tmp;

    var pv = A[col][col];
    for (var k = col; k <= p; k++) A[col][k] /= pv;
    for (var r2 = 0; r2 < p; r2++) {
      if (r2 === col) continue;
      var f = A[r2][col];
      if (f === 0) continue;
      for (var k2 = col; k2 <= p; k2++) A[r2][k2] -= f * A[col][k2];
    }
  }

  var beta = [];
  for (var z = 0; z < p; z++) beta.push(A[z][p]);
  return beta;
}

/**
 * Build the design matrix for one series and fit it.
 *
 * Columns are [intercept, timeIndex, Feb..Dec indicators]. January is the omitted reference
 * level, so each seasonal coefficient reads as tonnes above or below January at the same point
 * on the trend. `seasonal` is false for the trend-only fallback.
 */
function _fit(series, seasonal) {
  var n = series.length;
  var X = [];
  var y = [];
  for (var i = 0; i < n; i++) {
    var row = [1, i];
    if (seasonal) {
      for (var m = 2; m <= 12; m++) row.push(series[i].month === m ? 1 : 0);
    }
    X.push(row);
    y.push(series[i].tonnes);
  }

  var beta = _solveNormalEquations(X, y);
  if (!beta) return null;

  var meanY = 0;
  for (var a = 0; a < n; a++) meanY += y[a];
  meanY = n > 0 ? meanY / n : 0;

  var ssRes = 0;
  var ssTot = 0;
  for (var j = 0; j < n; j++) {
    var yhat = 0;
    for (var c = 0; c < beta.length; c++) yhat += beta[c] * X[j][c];
    ssRes += (y[j] - yhat) * (y[j] - yhat);
    ssTot += (y[j] - meanY) * (y[j] - meanY);
  }

  var dof = n - beta.length;
  // Residual standard error. With too few degrees of freedom the estimate is meaningless, so
  // fall back to the plain RMS of the residuals rather than dividing by zero or a negative.
  var sigma = dof > 0 ? Math.sqrt(ssRes / dof) : (n > 0 ? Math.sqrt(ssRes / n) : 0);

  return {
    beta: beta,
    seasonal: seasonal,
    n: n,
    rSquared: ssTot > 0 ? 1 - (ssRes / ssTot) : 0,
    sigma: sigma,
    dof: dof,
    meanY: meanY
  };
}

/** Predict one month from a fitted model. `idx` is the time index, `month` is 1-12. */
function _predict(fit, idx, month) {
  var v = fit.beta[0] + fit.beta[1] * idx;
  if (fit.seasonal && month >= 2 && month <= 12) v += fit.beta[1 + (month - 1)];
  return v;
}

/** Clamp the horizon: default 12, never below 1, never above 36. */
function _horizon(h) {
  if (h === null || h === undefined || h <= 0) return 12;
  return h > 36 ? 36 : h;
}

var DISCLAIMER = 'Projection, not a measurement. Produced by an ordinary-least-squares fit of ' +
  'monthly purchase emissions on a linear time index plus eleven monthly indicator variables, ' +
  'then extrapolated past the end of the ledger. It assumes purchasing behaviour, the category ' +
  'mix and the EPA emission factors all stay as they have been, which is exactly what a ' +
  'reduction programme is meant to falsify. No figure from this model is ever added to a ' +
  'reported total.';

var METHOD = 'ols_linear_trend_plus_monthly_seasonality';

/** Shared core so buildingForecast and allBuildingForecasts cannot drift apart. */
function _forecastOne(rec, horizonMonths, maxAbsMonth) {
  var series = rec.series;
  var h = _horizon(horizonMonths);

  var fit = null;
  var degraded = false;
  // Thirteen parameters need meaningfully more than thirteen observations before the fit says
  // anything; below that, do not pretend to resolve seasonality.
  if (series.length >= 24) fit = _fit(series, true);
  if (!fit) {
    fit = _fit(series, false);
    degraded = true;
  }
  if (!fit || series.length < 6) {
    return {
      buildingId: rec.id,
      buildingName: rec.name,
      fit: {
        fittable: false,
        observationCount: series.length,
        note: 'Not enough monthly history in this building to fit a trend. ' +
              series.length + ' observations available.'
      },
      method: METHOD,
      disclaimer: DISCLAIMER,
      projection: [],
      seasonalProfile: []
    };
  }

  // ---- projection -------------------------------------------------------------------------
  var projection = [];
  var band = 1.96 * fit.sigma;
  var projected12 = 0;
  for (var k = 1; k <= h; k++) {
    var idx = series.length - 1 + k;
    var abs = maxAbsMonth + k;
    var mo = (abs % 12) + 1;
    var point = _predict(fit, idx, mo);
    if (point < 0) point = 0;
    if (k <= 12) projected12 += point;
    projection.push({
      monthOffset: k,
      year: Math.floor(abs / 12),
      month: mo,
      monthName: MONTH_NAMES[mo - 1],
      projectedTonnes: _round1(point),
      lowerTonnes: _round1(Math.max(0, point - band)),
      upperTonnes: _round1(point + band)
    });
  }

  // ---- what to compare the projection against ---------------------------------------------
  //
  // The obvious choice — last twelve months *actual* versus next twelve months *projected* —
  // is wrong, and badly so. R-squared on these series runs 0.12-0.39, meaning the fit explains
  // a minority of month-to-month variation and the fitted line therefore sits close to the
  // long-run mean. Differencing an actual window against a fitted window makes the result
  // dominated by mean reversion rather than by trend: Engineering Hall had a quiet FY2025 and
  // that arithmetic reported it as "+209.6%", which reads as a prediction that the building is
  // about to triple. It is not. It is the model saying the last year was unusually low.
  //
  // So the headline change compares like with like — fitted trailing twelve against projected
  // next twelve — which isolates exactly what the model knows: trend plus seasonality. The
  // actual trailing figure is still returned, separately and labelled, because the gap between
  // it and the fitted value is the most honest available expression of the fit's uncertainty.
  var actualTrailing12 = 0;
  var fittedTrailing12 = 0;
  var startIdx = Math.max(0, series.length - 12);
  for (var t = startIdx; t < series.length; t++) {
    actualTrailing12 += series[t].tonnes;
    var fv = _predict(fit, t, series[t].month);
    fittedTrailing12 += (fv < 0 ? 0 : fv);
  }

  // ---- seasonal profile ------------------------------------------------------------------
  // Reported as the fitted deviation from January, which is literally what the coefficients
  // are: January is the omitted reference level, so its own deviation is zero by construction.
  var seasonalProfile = [];
  var peakMonth = null;
  var peakValue = null;
  if (fit.seasonal) {
    for (var m = 1; m <= 12; m++) {
      var dev = (m === 1) ? 0 : fit.beta[1 + (m - 1)];
      seasonalProfile.push({
        month: m,
        monthName: MONTH_NAMES[m - 1],
        deviationTonnes: _round1(dev)
      });
      if (peakValue === null || dev > peakValue) { peakValue = dev; peakMonth = m; }
    }
  }

  // Two different true statements can be made about beta[1], and reporting the wrong one next to
  // changePct looks like a contradiction. beta[1]*12 is how much a *single month* gains over a
  // year (2.8 t for Chemistry). A *twelve-month total* gains twelve times that, because every one
  // of its twelve months has moved up the trend (33.6 t) — which is the figure changePct is a
  // percentage of. Only the second is reported, named for what it measures, so the headline
  // change and the trend can never be read as disagreeing.
  var monthlyLevelGainPerYear = fit.beta[1] * 12;
  var annualTotalDelta = monthlyLevelGainPerYear * 12;

  var changePct = fittedTrailing12 > 0
    ? ((projected12 - fittedTrailing12) / fittedTrailing12) * 100 : 0;

  // Direction is judged against the building's own scale, not an absolute tonnage: 2.8 t/year is a
  // steep climb for a building emitting 20 t/year and noise for one emitting 370. The denominator
  // is deliberately the same one changePct uses, so this is changePct's own ratio thresholded at
  // +/-1% rather than a second percentage computed a second way — two near-identical percentages
  // in one payload would read as a contradiction even when both are correct.
  var trendBase = fittedTrailing12 > 0 ? fittedTrailing12 : fit.meanY * 12;
  var trendPct = trendBase > 0 ? (annualTotalDelta / trendBase) * 100 : 0;
  var direction = trendPct > 1 ? 'rising' : (trendPct < -1 ? 'falling' : 'flat');

  return {
    buildingId: rec.id,
    buildingName: rec.name,
    fit: {
      fittable: true,
      seasonalTermsFitted: fit.seasonal,
      degradedToTrendOnly: degraded,
      observationCount: fit.n,
      parameterCount: fit.beta.length,
      degreesOfFreedom: fit.dof,
      rSquared: _round2(fit.rSquared),
      residualSigmaTonnes: _round1(fit.sigma),
      meanMonthlyTonnes: _round1(fit.meanY),
      confidenceLevelPct: 95,
      note: degraded
        ? 'Seasonal terms could not be identified for this building (a calendar month with no ' +
          'purchases in any year leaves its indicator column empty), so this is a trend-only fit.'
        : 'Trend plus eleven monthly indicators, January as the reference month.'
    },
    trend: {
      // The raw slope coefficient, in tonnes per month of elapsed time.
      tonnesPerMonthIndex: _round2(fit.beta[1]),
      // Year-on-year change in a twelve-month total — the same quantity `outlook.changeTonnes`
      // reports, net of the seasonal terms, which cancel between any two aligned twelve-month
      // windows.
      annualTotalDeltaTonnes: _round1(annualTotalDelta),
      direction: direction
    },
    outlook: {
      // The model-to-model comparison: both sides of this subtraction come off the fitted line,
      // so the delta is trend plus seasonality and nothing else.
      fittedTrailing12MonthsTonnes: _round1(fittedTrailing12),
      next12MonthsTonnes: _round1(projected12),
      changeTonnes: _round1(projected12 - fittedTrailing12),
      changePct: _round1(changePct),
      confidenceBandTonnes: _round1(band),
      peakMonth: peakMonth ? MONTH_NAMES[peakMonth - 1] : null,
      // Measured, for context. `modelVsActualPct` is how far the fit sits from what actually
      // happened over the same twelve months — the plainest statement of fit quality available
      // without reading rSquared, and the reason the projection is not the actual continued.
      actualTrailing12MonthsTonnes: _round1(actualTrailing12),
      modelVsActualPct: actualTrailing12 > 0
        ? _round1(((fittedTrailing12 - actualTrailing12) / actualTrailing12) * 100) : 0
    },
    seasonalProfile: seasonalProfile,
    projection: projection,
    method: METHOD,
    disclaimer: DISCLAIMER
  };
}

/** @see ForecastAgent.c3typ */
function buildingForecast(buildingId, horizonMonths) {
  var all = _monthlySeriesByBuilding();
  var match = null;
  for (var i = 0; i < all.buildings.length; i++) {
    if (all.buildings[i].id === buildingId) { match = all.buildings[i]; break; }
  }
  if (!match) {
    return {
      buildingId: buildingId,
      buildingName: null,
      fit: {
        fittable: false,
        observationCount: 0,
        note: 'No building with id "' + buildingId + '" has any purchase history in the ledger.'
      },
      method: METHOD,
      disclaimer: DISCLAIMER,
      projection: [],
      seasonalProfile: []
    };
  }
  var res = _forecastOne(match, horizonMonths, all.maxAbsMonth);
  res.ledgerThroughYear = Math.floor(all.maxAbsMonth / 12);
  res.ledgerThroughMonth = (all.maxAbsMonth % 12) + 1;
  return res;
}

/** @see ForecastAgent.c3typ */
function allBuildingForecasts(horizonMonths) {
  var all = _monthlySeriesByBuilding();
  var rows = [];
  var totalProjected = 0;
  var totalFittedTrailing = 0;
  var totalActualTrailing = 0;

  for (var i = 0; i < all.buildings.length; i++) {
    var f = _forecastOne(all.buildings[i], horizonMonths, all.maxAbsMonth);
    if (f.fit.fittable) {
      totalProjected += f.outlook.next12MonthsTonnes;
      totalFittedTrailing += f.outlook.fittedTrailing12MonthsTonnes;
      totalActualTrailing += f.outlook.actualTrailing12MonthsTonnes;
    }
    rows.push({
      buildingId: f.buildingId,
      buildingName: f.buildingName,
      fittable: f.fit.fittable,
      rSquared: f.fit.fittable ? f.fit.rSquared : null,
      observationCount: f.fit.observationCount,
      seasonalTermsFitted: f.fit.fittable ? f.fit.seasonalTermsFitted : false,
      fittedTrailing12MonthsTonnes: f.fit.fittable ? f.outlook.fittedTrailing12MonthsTonnes : null,
      actualTrailing12MonthsTonnes: f.fit.fittable ? f.outlook.actualTrailing12MonthsTonnes : null,
      next12MonthsTonnes: f.fit.fittable ? f.outlook.next12MonthsTonnes : null,
      changeTonnes: f.fit.fittable ? f.outlook.changeTonnes : null,
      changePct: f.fit.fittable ? f.outlook.changePct : null,
      modelVsActualPct: f.fit.fittable ? f.outlook.modelVsActualPct : null,
      direction: f.fit.fittable ? f.trend.direction : null,
      trendAnnualTotalDeltaTonnes: f.fit.fittable ? f.trend.annualTotalDeltaTonnes : null,
      confidenceBandTonnes: f.fit.fittable ? f.outlook.confidenceBandTonnes : null,
      residualSigmaTonnes: f.fit.fittable ? f.fit.residualSigmaTonnes : null,
      peakMonth: f.fit.fittable ? f.outlook.peakMonth : null,
      note: f.fit.note
    });
  }

  rows.sort(function (a, b) {
    var av = a.next12MonthsTonnes === null ? -1 : a.next12MonthsTonnes;
    var bv = b.next12MonthsTonnes === null ? -1 : b.next12MonthsTonnes;
    return bv - av;
  });

  return {
    horizonMonths: _horizon(horizonMonths),
    buildingCount: rows.length,
    fittableCount: (function () {
      var c = 0;
      for (var z = 0; z < rows.length; z++) if (rows[z].fittable) c++;
      return c;
    })(),
    ledgerThroughYear: Math.floor(all.maxAbsMonth / 12),
    ledgerThroughMonth: (all.maxAbsMonth % 12) + 1,
    campusFittedTrailing12MonthsTonnes: _round1(totalFittedTrailing),
    campusActualTrailing12MonthsTonnes: _round1(totalActualTrailing),
    campusNext12MonthsTonnes: _round1(totalProjected),
    campusChangePct: totalFittedTrailing > 0
      ? _round1(((totalProjected - totalFittedTrailing) / totalFittedTrailing) * 100) : 0,
    rows: rows,
    method: METHOD,
    disclaimer: DISCLAIMER
  };
}
