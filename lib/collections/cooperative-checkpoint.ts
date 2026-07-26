export interface CooperativeCheckpoint {
  checkpoint: () => Promise<void>;
}
