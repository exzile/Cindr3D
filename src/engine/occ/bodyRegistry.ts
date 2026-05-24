import type { BRepBody } from './brepBody';

export interface BRepBodyRegistrySnapshot {
  bodyCount: number;
  bodyIds: string[];
  featureIds: string[];
}

export class BRepBodyRegistry {
  private readonly bodies = new Map<string, BRepBody>();
  private readonly featureToBodyIds = new Map<string, Set<string>>();

  add(body: BRepBody): void {
    this.delete(body.id);
    this.bodies.set(body.id, body);
    if (body.sourceFeatureId) {
      let bodyIds = this.featureToBodyIds.get(body.sourceFeatureId);
      if (!bodyIds) {
        bodyIds = new Set();
        this.featureToBodyIds.set(body.sourceFeatureId, bodyIds);
      }
      bodyIds.add(body.id);
    }
  }

  get(bodyId: string): BRepBody | undefined {
    return this.bodies.get(bodyId);
  }

  getByFeature(featureId: string): BRepBody[] {
    const bodyIds = this.featureToBodyIds.get(featureId);
    if (!bodyIds) return [];
    return Array.from(bodyIds, (bodyId) => this.bodies.get(bodyId)).filter((body): body is BRepBody => Boolean(body));
  }

  delete(bodyId: string): boolean {
    const body = this.bodies.get(bodyId);
    if (!body) return false;

    this.bodies.delete(bodyId);
    if (body.sourceFeatureId) {
      const bodyIds = this.featureToBodyIds.get(body.sourceFeatureId);
      bodyIds?.delete(bodyId);
      if (bodyIds?.size === 0) this.featureToBodyIds.delete(body.sourceFeatureId);
    }
    body.dispose();
    return true;
  }

  clear(): void {
    for (const bodyId of Array.from(this.bodies.keys())) {
      this.delete(bodyId);
    }
  }

  snapshot(): BRepBodyRegistrySnapshot {
    return {
      bodyCount: this.bodies.size,
      bodyIds: Array.from(this.bodies.keys()),
      featureIds: Array.from(this.featureToBodyIds.keys()),
    };
  }
}
