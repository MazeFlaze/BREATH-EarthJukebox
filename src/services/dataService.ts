import mockData from "@/data/observations.json";
import { Dataset } from "@/types/dataset";
import { Observation } from "@/types/observation";

/**
 * Data Service
 * 
 * Primary integration boundary for Workstream N01 (Data Engineering).
 * Manages atmospheric datasets, observation queries, and provenance validation.
 */
class DataService {
  private currentDataset: Dataset;

  constructor() {
    // Initialize with local mock dataset for development
    this.currentDataset = mockData.dataset as unknown as Dataset;
  }

  /**
   * Retrieves the currently active dataset.
   */
  public async getDataset(): Promise<Dataset> {
    return Promise.resolve(this.currentDataset);
  }

  /**
   * Retrieves all observations ordered chronologically.
   */
  public async getObservations(): Promise<Observation[]> {
    return Promise.resolve(
      [...this.currentDataset.observations].sort(
        (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      )
    );
  }

  /**
   * Retrieves a single observation by its unique identifier.
   */
  public async getObservationById(id: string): Promise<Observation | null> {
    const obs = this.currentDataset.observations.find((item) => item.id === id);
    return Promise.resolve(obs || null);
  }

  /**
   * Computes the numeric minimum and maximum values across all current observations.
   * Useful for dynamic chart scaling and sonification normalization.
   */
  public async getDatasetRange(): Promise<{ min: number; max: number }> {
    const obs = this.currentDataset.observations;
    if (obs.length === 0) return { min: 0, max: 1 };

    const values = obs.map((o) => o.value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    return { min, max };
  }

  /**
   * Checks whether the current dataset is flagged as development mock data.
   */
  public isMock(): boolean {
    return Boolean(this.currentDataset.isMock);
  }

  /**
   * Integration point for N01: Load verified NASA observations (e.g. from JSON file or API).
   */
  public setDataset(dataset: Dataset): void {
    this.currentDataset = dataset;
  }
}

export const dataService = new DataService();
