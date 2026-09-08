/**
 * Budget guard — tracks cumulative spend against a max-spend cap.
 *
 * Pure logic, no I/O, so it is unit-testable in isolation. The agent asks the
 * guard before every paid query; the guard refuses any charge that would push
 * cumulative spend over the cap.
 */

/** Thrown when a charge would exceed the configured cap. */
export class BudgetExceededError extends Error {
  constructor(
    readonly attempted: number,
    readonly spent: number,
    readonly cap: number,
  ) {
    super(
      `Charge of ${attempted} HBAR would exceed cap: ` +
        `${spent} already spent of ${cap} allowed`,
    );
    this.name = "BudgetExceededError";
  }
}

export class Budget {
  private spent = 0;

  constructor(private readonly capHbar: number) {
    if (!Number.isFinite(capHbar) || capHbar <= 0) {
      throw new Error(`Invalid budget cap: ${capHbar}`);
    }
  }

  /** HBAR spent so far. */
  get totalSpent(): number {
    return this.spent;
  }

  /** HBAR still available under the cap. */
  get remaining(): number {
    return this.capHbar - this.spent;
  }

  /** True if a charge of `amountHbar` fits within the remaining budget. */
  canAfford(amountHbar: number): boolean {
    if (!Number.isFinite(amountHbar) || amountHbar < 0) return false;
    return this.spent + amountHbar <= this.capHbar;
  }

  /**
   * Record a charge. Throws BudgetExceededError if it would exceed the cap,
   * leaving recorded spend unchanged.
   */
  charge(amountHbar: number): void {
    if (!Number.isFinite(amountHbar) || amountHbar < 0) {
      throw new Error(`Invalid charge amount: ${amountHbar}`);
    }
    if (!this.canAfford(amountHbar)) {
      throw new BudgetExceededError(amountHbar, this.spent, this.capHbar);
    }
    this.spent += amountHbar;
  }
}
