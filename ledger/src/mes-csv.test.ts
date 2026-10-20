import { test } from "node:test";
import assert from "node:assert/strict";
import { celdaCsv } from "./mes.ts";

// The CSV books are read by spreadsheets: a cell that starts like a formula must not run as one.

test("a cell that starts with a formula character gets a leading apostrophe", () => {
  // The apostrophe comes first, then the quotes are doubled and the cell is quoted, because it has quotes.
  assert.equal(celdaCsv('=HYPERLINK("x")'), `"'=HYPERLINK(""x"")"`);
  assert.equal(celdaCsv("=1+1"), "'=1+1");
  assert.equal(celdaCsv("+5"), "'+5");
  assert.equal(celdaCsv("@SUM(A1)"), "'@SUM(A1)");
  assert.equal(celdaCsv("\tcelda"), "'\tcelda");
});

test("a formula cell that also has a semicolon is quoted, with its quotes doubled", () => {
  assert.equal(celdaCsv("=A1;B1"), "\"'=A1;B1\"");
  assert.equal(celdaCsv("dice \"hola\"; chau"), "\"dice \"\"hola\"\"; chau\"");
});

test("amounts keep their form: a negative amount is not a formula", () => {
  assert.equal(celdaCsv("-1,50"), "-1,50");
  assert.equal(celdaCsv("-0.25"), "-0.25");
  assert.equal(celdaCsv(-3), "-3");
});

test("ordinary text and empty cells are written as they are", () => {
  assert.equal(celdaCsv("Consumidor final"), "Consumidor final");
  assert.equal(celdaCsv(null), "");
  assert.equal(celdaCsv(12), "12");
});
