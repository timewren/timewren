import {
  BottomSheetScrollView as GBottomSheetScrollView,
  BottomSheetTextInput as GBottomSheetTextInput,
  BottomSheetView as GBottomSheetView,
} from '@gorhom/bottom-sheet';
import { withUniwind } from 'uniwind';

/** @gorhom/bottom-sheet-komponenter med className-understøttelse. */
export const BottomSheetView = withUniwind(GBottomSheetView);
export const BottomSheetTextInput = withUniwind(GBottomSheetTextInput);
export const BottomSheetScrollView = withUniwind(GBottomSheetScrollView);
