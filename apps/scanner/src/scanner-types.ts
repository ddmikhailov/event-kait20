import type {
  AttendanceSyncResponse as ContractAttendanceSyncResponse,
  OfflineBundleResponse as ContractOfflineBundleResponse,
  ResolveQrResponse as ContractResolveQrResponse,
} from '@event-registration/contracts';

export type AttendanceMode =
  'MANUAL_CONFIRM' | 'FAST_SCAN' | 'MANUAL_SEARCH' | 'ONSITE_REGISTRATION';
export type AttendanceSyncResponse = ContractAttendanceSyncResponse;
export type OfflineBundleResponse = ContractOfflineBundleResponse;
export type ResolveQrResponse = ContractResolveQrResponse;
