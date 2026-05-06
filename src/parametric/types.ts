import type * as THREE from 'three';

export type ParametricParameterType = 'number' | 'select' | 'boolean';
export type ParametricParameterValue = number | string | boolean;

export interface ParametricParameterDefinition {
  key: string;
  label: string;
  type: ParametricParameterType;
  defaultValue: ParametricParameterValue;
  min?: number;
  max?: number;
  step?: number;
  options?: Array<{ label: string; value: string }>;
}

export interface ParametricModelDefinition {
  id: string;
  name: string;
  category: string;
  description: string;
  parameters: ParametricParameterDefinition[];
  build: (params: Record<string, ParametricParameterValue>) => THREE.Mesh;
}
