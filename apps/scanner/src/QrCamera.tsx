import { BrowserQRCodeReader, type IScannerControls } from '@zxing/browser';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { acceptQrRead } from './qr-repeat-guard.js';

type QrCameraProps = {
  active: boolean;
  onDecode: (value: string) => void;
};

export const QrCamera = ({ active, onDecode }: QrCameraProps) => {
  const video = useRef<HTMLVideoElement>(null);
  const notifyDecode = useEffectEvent(onDecode);
  const lastRead = useRef({ value: '', lastSeenAt: 0 });
  const [error, setError] = useState<string>();

  useEffect(() => {
    const videoElement = video.current;
    if (!active || !videoElement) return undefined;
    let controls: IScannerControls | undefined;
    let cancelled = false;
    lastRead.current.lastSeenAt = Date.now();
    const reader = new BrowserQRCodeReader(undefined, {
      delayBetweenScanAttempts: 150,
      delayBetweenScanSuccess: 700,
    });
    reader
      .decodeFromConstraints(
        {
          audio: false,
          video: { facingMode: { ideal: 'environment' } },
        },
        videoElement,
        (result) => {
          if (cancelled) return;
          const value = result?.getText();
          if (acceptQrRead(lastRead.current, value, Date.now()) && value)
            notifyDecode(value);
        },
      )
      .then((scannerControls) => {
        controls = scannerControls;
        if (cancelled) controls.stop();
        else setError(undefined);
      })
      .catch(() => {
        if (!cancelled) {
          setError('Не удалось открыть камеру. Проверьте разрешение браузера.');
        }
      });
    return () => {
      cancelled = true;
      controls?.stop();
      BrowserQRCodeReader.cleanVideoSource(videoElement);
    };
  }, [active]);

  return (
    <div className="camera-frame" aria-label="Область сканирования QR">
      <video ref={video} muted playsInline aria-label="Изображение с камеры" />
      <span className="camera-target" aria-hidden="true" />
      {!active && <p className="camera-hint">Камера приостановлена</p>}
      {error && <p className="camera-error">{error}</p>}
    </div>
  );
};
