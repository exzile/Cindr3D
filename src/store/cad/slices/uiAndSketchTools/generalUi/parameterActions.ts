import type { Parameter } from "../../../../../types/cad";
import { evaluateExpression, resolveParameters } from "../../../../../utils/expressionEval";
import type { CADSliceContext } from "../../../sliceContext";
import type { CADState } from "../../../state";

export function createParameterActions({ set, get }: CADSliceContext): Partial<CADState> {
  return {
    parameters: [],
    addParameter: (name, expression, description, group) => {
      const newParam: Parameter = {
        id: crypto.randomUUID(),
        name,
        expression,
        value: NaN,
        description,
        group,
      };
      set((state) => ({
        parameters: resolveParameters([...state.parameters, newParam]),
      }));
    },
    updateParameter: (id, updates) => {
      set((state) => {
        const updated = state.parameters.map((parameter) =>
          parameter.id === id ? { ...parameter, ...updates } : parameter,
        );
        return { parameters: resolveParameters(updated) };
      });
    },
    removeParameter: (id) => {
      set((state) => ({
        parameters: resolveParameters(
          state.parameters.filter((parameter) => parameter.id !== id),
        ),
      }));
    },
    evaluateExpression: (expression) => evaluateExpression(expression, get().parameters),
  };
}
