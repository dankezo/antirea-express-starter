"use strict";
// Deterministic 500-record demo dataset. No file, no network, same
// records on every run - the same trick the internal antiRea range uses.
const CATEGORIES = ["gear", "books", "games", "music", "home"];

const PRODUCTS = [];
for (let i = 1; i <= 500; i++) {
  PRODUCTS.push({
    id: `prod-${String(i).padStart(4, "0")}`,
    name: `Demo product ${i}`,
    category: CATEGORIES[i % CATEGORIES.length],
    price: ((i * 37) % 200) + 5,
    blurb: `Generated catalogue text for demo product ${i}.`,
  });
}
const PRODUCT_BY_ID = new Map(PRODUCTS.map((p) => [p.id, p]));

module.exports = { PRODUCTS, PRODUCT_BY_ID };
