/** Contracts shared by the two spellings of one empty-lbv declaration. */

export interface IReportRenderer {
  render: () => string;
}

export interface IReportClock {
  now: () => number;
}

export interface IReportGateway {
  renderNow: () => string;
}
