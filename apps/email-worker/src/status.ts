export const getWorkerStatus = () =>
  ({
    service: 'email-worker',
    status: 'ready',
  }) as const;
