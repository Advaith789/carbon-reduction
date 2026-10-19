/*
 * Copyright 2009-2026 C3 AI (www.c3.ai). All Rights Reserved.
 * Confidential and Proprietary C3 Materials.
 * This material, including without limitation any software, is the confidential trade secret and proprietary
 * information of C3 and its licensors. Reproduction, use and/or distribution of this material in any form is
 * strictly prohibited except as set forth in a written license agreement with C3 and/or its authorized distributors.
 * This material may be covered by one or more patents or pending patent applications.
 */

import { BookOpen, Gauge, Map, ShoppingCart, Target } from 'lucide-react';

import { NavigationItem } from '@/types/navigation';

/**
 * Navigation configuration for the application.
 *
 * The order is the argument, and it is deliberate: **past → present → future**.
 * Measure the footprint, locate it on the ground, intervene at the moment of
 * purchase, then plan the trajectory — and finally show your working. Reordering
 * these items breaks the narrative the application is built to tell.
 *
 * This is also why the FAQ is **not** a sixth item. It is a reference surface rather
 * than a step in the argument, and a sixth entry would read as "and then, finally,
 * some definitions" — so it was absorbed into the methodology page, which was already
 * the place a sceptical reader goes to check the working. Inline terms link straight
 * into it, so it is reachable from anywhere without occupying a slot in the story.
 *
 * To add a new page:
 * 1. Add a new item to this array
 * 2. Make sure the path matches your route in App.tsx
 * 3. Add the corresponding page component
 */
export const navigationConfig: NavigationItem[] = [
  {
    id: 'overview',
    path: '/',
    icon: Gauge,
    iconActive: Gauge,
    label: 'Footprint',
    tooltip: 'Where the purchasing carbon actually is',
  },
  {
    id: 'map',
    path: '/map',
    icon: Map,
    iconActive: Map,
    label: 'Campus map',
    tooltip: 'The same footprint, placed on the ground',
  },
  {
    id: 'intercept',
    path: '/intercept',
    icon: ShoppingCart,
    iconActive: ShoppingCart,
    label: 'Intercept',
    tooltip: "Today's purchase requests, before the money is committed",
  },
  {
    id: 'planner',
    path: '/planner',
    icon: Target,
    iconActive: Target,
    label: 'Planner',
    tooltip: 'Scenario planning against the published targets',
  },
  {
    id: 'methodology',
    path: '/methodology',
    icon: BookOpen,
    iconActive: BookOpen,
    label: 'Method & FAQ',
    tooltip: 'Factors, provenance, what is modelled — and every term defined',
  },
];

/**
 * Helper function to add navigation item dynamically
 */
export const addNavigationItem = (item: NavigationItem) => {
  navigationConfig.push(item);
};

/**
 * Helper function to remove navigation item
 */
export const removeNavigationItem = (id: string) => {
  const index = navigationConfig.findIndex((item) => item.id === id);
  if (index > -1) {
    navigationConfig.splice(index, 1);
  }
};

/**
 * Helper function to update badge count
 */
export const updateNavigationBadge = (id: string, badge?: number) => {
  const item = navigationConfig.find((item) => item.id === id);
  if (item) {
    item.badge = badge;
  }
};
