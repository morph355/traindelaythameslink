export interface CommutePreset {
  label: string;
  /** HHmm */
  time: string;
}

/**
 * Your regular split-save commute. Edit this if your route, split point, or
 * usual departure times change - it's the only place they're defined.
 */
export const COMMUTE = {
  fromCrs: "BTN",
  fromName: "Brighton",
  viaCrs: "GTW",
  viaName: "Gatwick Airport",
  toCrs: "LBG",
  toName: "London Bridge",
  /** Preset outbound departure times from `fromCrs`. Return has no presets - it's less regular. */
  outboundPresets: [
    { label: "06:39", time: "0639" },
    { label: "06:56", time: "0656" },
  ] as CommutePreset[],
  ticketLabels: {
    outboundLeg1: "Brighton to Gatwick Airport",
    outboundLeg2: "Gatwick Airport to London Bridge",
    returnLeg1: "London Bridge to Gatwick Airport",
    returnLeg2: "Gatwick Airport to Brighton",
  },
};
