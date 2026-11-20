import type { StepProps } from '../stepContract';

export function StepRouter({ step }: StepProps) {
  return <div data-step-type={step.type} data-step-id={step.id} />;
}
