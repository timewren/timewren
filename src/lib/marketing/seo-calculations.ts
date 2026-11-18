export const calculations = {
  overtime: ([actual, norm, rate, supplement]: number[]) => {
    const overtime = Math.max(0, actual - norm);
    return [overtime, overtime * rate * (1 + supplement / 100)];
  },
  holiday: ([hours, rate, supplements]: number[]) => {
    const wages = hours * rate + supplements;
    return [wages, wages * 0.125];
  },
  flex: ([opening, actual, norm, timeOff]: number[]) => {
    const change = actual - norm;
    return [change, opening + change - timeOff];
  },
  rounding: ([hours, minutes, interval]: number[]) => {
    const total = hours * 60 + minutes;
    const billed = Math.ceil(total / interval) * interval;
    return [billed, billed - total];
  },
  budget: ([budget, spent, remaining]: number[]) => {
    const forecast = spent + remaining;
    return [budget - spent, forecast, budget - forecast];
  },
  effective: ([revenue, costs, billable, other]: number[]) => {
    const profit = revenue - costs;
    const hours = billable + other;
    const rate = profit / hours;
    return [profit, hours > 0 && Number.isFinite(rate) ? rate : null];
  },
};

export type Calculation = keyof typeof calculations;
