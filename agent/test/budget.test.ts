/**
 * Tests for the budget guard (pure spend math, no I/O).
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { Budget, BudgetExceededError } from "../src/budget.js";

test("rejects a non-positive cap at construction", () => {
  assert.throws(() => new Budget(0), /Invalid budget cap/);
  assert.throws(() => new Budget(-1), /Invalid budget cap/);
  assert.throws(() => new Budget(Number.NaN), /Invalid budget cap/);
});

test("starts with full cap available and nothing spent", () => {
  const budget = new Budget(1.0);
  assert.equal(budget.totalSpent, 0);
  assert.equal(budget.remaining, 1.0);
});

test("canAfford respects the remaining budget, including the exact boundary", () => {
  const budget = new Budget(1.0);
  assert.equal(budget.canAfford(0.5), true);
  assert.equal(budget.canAfford(1.0), true); // exact cap fits
  assert.equal(budget.canAfford(1.01), false); // one tick over
});

test("canAfford rejects invalid amounts", () => {
  const budget = new Budget(1.0);
  assert.equal(budget.canAfford(-0.1), false);
  assert.equal(budget.canAfford(Number.NaN), false);
  assert.equal(budget.canAfford(Number.POSITIVE_INFINITY), false);
});

test("charge accumulates spend and reduces remaining", () => {
  const budget = new Budget(1.0);
  budget.charge(0.3);
  budget.charge(0.2);
  assert.equal(budget.totalSpent, 0.5);
  assert.equal(budget.remaining, 0.5);
});

test("charge up to the exact cap is allowed", () => {
  const budget = new Budget(1.0);
  budget.charge(0.6);
  budget.charge(0.4);
  assert.equal(budget.totalSpent, 1.0);
  assert.equal(budget.remaining, 0);
  assert.equal(budget.canAfford(0.0000001), false);
});

test("charge over the cap throws and leaves spend unchanged", () => {
  const budget = new Budget(1.0);
  budget.charge(0.7);
  assert.throws(() => budget.charge(0.4), BudgetExceededError);
  // The rejected charge must not have been recorded.
  assert.equal(budget.totalSpent, 0.7);
  // Float tolerance: 1.0 - 0.7 is 0.30000000000000004 in IEEE-754.
  assert.ok(Math.abs(budget.remaining - 0.3) < 1e-9);
});

test("BudgetExceededError carries the attempted/spent/cap context", () => {
  const budget = new Budget(1.0);
  budget.charge(0.7);
  try {
    budget.charge(0.5);
    assert.fail("expected BudgetExceededError");
  } catch (err) {
    assert.ok(err instanceof BudgetExceededError);
    assert.equal(err.attempted, 0.5);
    assert.equal(err.spent, 0.7);
    assert.equal(err.cap, 1.0);
  }
});

test("charge rejects invalid amounts", () => {
  const budget = new Budget(1.0);
  assert.throws(() => budget.charge(-0.1), /Invalid charge amount/);
  assert.throws(() => budget.charge(Number.NaN), /Invalid charge amount/);
});
