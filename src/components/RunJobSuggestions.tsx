type Props = {
  lines: unknown[];
  orders: unknown[];
  sites: unknown[];
  remainingCapacity?: number;
  busy: boolean;
  onAdd: (orderId: string) => void;
};

/**
 * Route Intelligence has intentionally been removed from the Runs workflow.
 * Route building now belongs to the Beta Optimiser proposal flow and resource
 * intelligence belongs to Driver Dispatch. Keeping this compatibility shell
 * avoids coupling the live Run builder to a second, competing planning engine.
 */
export function RunJobSuggestions(props: Props) {
  void props;
  return null;
}
