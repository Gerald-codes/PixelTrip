/** Selection service — mock: nothing locked yet. */
import type { Unsubscribe } from "@/types";

import type { RoomSelections, SelectionService } from "./selection.contract";

export class MockSelectionService implements SelectionService {
  subscribeSelections(
    _roomId: string,
    onChange: (selections: RoomSelections) => void,
  ): Unsubscribe {
    onChange({ destination: null, flight: null });
    return () => {};
  }
}
