/**
 * content/category.ts — ClimbCategory → CSS class and color mappings.
 *
 * Exports: getCategoryClass, getCategoryColor
 */

import type { ClimbCategory } from "../types";

export const CATEGORY_CLASS: Record<ClimbCategory, string> = {
  HC: "hc",
  "1": "cat1",
  "2": "cat2",
  "3": "cat3",
  "4": "cat4",
  uncategorized: "uncat",
};

export const CATEGORY_COLOR: Record<ClimbCategory, string> = {
  HC: "#800020",
  "1": "#D32F2F",
  "2": "#F57C00",
  "3": "#FBC02D",
  "4": "#4CAF50",
  uncategorized: "#9E9E9E",
};

export function getCategoryClass(cat: ClimbCategory): string {
  return CATEGORY_CLASS[cat] ?? "uncat";
}

export function getCategoryColor(cat: ClimbCategory): string {
  return CATEGORY_COLOR[cat] ?? "#9E9E9E";
}
