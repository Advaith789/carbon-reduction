/*
 * Copyright 2009-2026 C3 AI (www.c3.ai). All Rights Reserved.
 * Confidential and Proprietary C3 Materials.
 * This material, including without limitation any software, is the confidential trade secret and proprietary
 * information of C3 and its licensors. Reproduction, use and/or distribution of this material in any form is
 * strictly prohibited except as set forth in a written license agreement with C3 and/or its authorized distributors.
 * This material may be covered by one or more patents or pending patent applications.
 */

import React from 'react';
import { Route, Routes } from 'react-router-dom';
import SideNav from './components/SideNav/SideNav';
import TopNav from './components/TopNav/TopNav';
import ErrorReporterProvider from './components/ErrorBoundary/ErrorBoundary';
import { BadgerDataProvider } from './contexts/BadgerDataProvider';
import { BuckyProvider } from './contexts/BuckyProvider';
import BuckyDock from './components/badger/BuckyDock';
import Overview from './pages/Overview/Overview';
import CampusMap from './pages/CampusMap/CampusMap';
import Intercept from './pages/Intercept/Intercept';
import Planner from './pages/Planner/Planner';
import Methodology from './pages/Methodology/Methodology';

/**
 * Application shell.
 *
 * The chrome — {@link TopNav} across the top and {@link SideNav} down the left —
 * is rendered here, OUTSIDE `<Routes>`, so it is present on **every** page. The
 * router only ever swaps the `<main>` content; the top bar and side nav are part
 * of the shell and cannot be dropped by an individual page. Per the C3 Design
 * System, the TopNavBar is expected on every screen — keep it mounted here and
 * do not move it inside a route.
 *
 * {@link BadgerDataProvider} wraps the router rather than any single page: the
 * dataset is fetched once and shared, so moving between the measurement, map,
 * intercept and planner views costs no further round trips and every page shows
 * numbers that provably came from the same query.
 *
 * {@link BuckyProvider} wraps it for the same reason, applied to conversation rather
 * than data: there is exactly one transcript and it lives above `<Routes>`, so asking a
 * question on the map and then walking over to the intercept to act on the answer does
 * not silently discard the thread. {@link BuckyDock} — the floating launcher and popup —
 * is mounted here beside the chrome rather than inside a page, because a chat you have to
 * navigate to find is a panel, not an assistant.
 */
export default function App() {
  return (
    <ErrorReporterProvider>
      <BadgerDataProvider>
        <BuckyProvider>
          <div className="h-screen flex flex-col max-w-full overflow-hidden">
            <TopNav title="Badger Footprint" />
            <div className="flex flex-1 min-h-0">
              <SideNav />
              <div className="flex-1 flex flex-col min-w-0">
                <main className="flex-1 overflow-auto bg-[var(--c3-style-basic-bg-page)]">
                  <Routes>
                    <Route path="/" element={<Overview />} />
                    <Route path="/map" element={<CampusMap />} />
                    <Route path="/intercept" element={<Intercept />} />
                    <Route path="/planner" element={<Planner />} />
                    <Route path="/methodology" element={<Methodology />} />
                    <Route
                      path="*"
                      element={
                        <div className="flex h-full items-center justify-center p-8 text-center text-[var(--c3-style-basic-fg-neutral)]">
                          <p>Page not found.</p>
                        </div>
                      }
                    />
                  </Routes>
                </main>
              </div>
            </div>
          </div>
          <BuckyDock />
        </BuckyProvider>
      </BadgerDataProvider>
    </ErrorReporterProvider>
  );
}
