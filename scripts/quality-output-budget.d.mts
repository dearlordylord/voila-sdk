export interface SuccessfulOutputBudget {
  readonly currentOutputLines: number
  readonly maximumOutputLines: number
  readonly stageName: string
  readonly stageOutputLines: number
}

export declare const addSuccessfulOutputLines: (budget: SuccessfulOutputBudget) => number
