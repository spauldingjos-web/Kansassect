import React, { useState } from 'react';
import { Download, Smartphone, WifiOff, Share, PlusSquare, X } from 'lucide-react';
import { usePWAInstall, useOnlineStatus } from '../hooks/usePWAInstall';

export const OfflineIndicator: React.FC<{ forceOfflineMode?: boolean; cachedTileCount?: number }> = ({
  forceOfflineMode = false,
  cachedTileCount = 0,
}) => {
  const isOnline = useOnlineStatus();
  const offline = !isOnline || forceOfflineMode;

  if (!offline) return null;

  return (
    <div
      role="status"
      className="px-3 py-1 rounded-full bg-[#2b1a0e]/95 border border-[#ea580c] text-[#ffedd5] text-[11px] font-mono font-bold flex items-center gap-1.5 shadow-lg"
    >
      <WifiOff className="w-3.5 h-3.5 text-[#f97316] shrink-0" />
      <span>
        OFFLINE FIELD MODE{cachedTileCount > 0 ? ` · ${cachedTileCount} TILES` : ''}
      </span>
    </div>
  );
};

interface PWAInstallButtonProps {
  compact?: boolean;
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({ compact = false }) => {
  const { canInstall, isInstalled, isIOS, promptInstall } = usePWAInstall();
  const [showIosGuide, setShowIosGuide] = useState(false);

  if (isInstalled) return null;
  // On desktop Chrome before beforeinstallprompt fires, allow showing only if native prompt or iOS
  if (!canInstall && !isIOS) return null;

  const handleClick = async () => {
    const res = await promptInstall();
    if (res === 'ios') {
      setShowIosGuide(true);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        className={
          compact
            ? 'pointer-events-auto px-2.5 py-1.5 rounded-2xl bg-[#141a11]/92 hover:bg-[#1f2919] border border-[#ea580c]/70 text-[#f4f1ea] text-[11px] font-bold flex items-center gap-1.5 shadow-xl whitespace-nowrap'
            : 'w-full py-3 px-4 rounded-2xl bg-[#ea580c] hover:bg-[#f97316] text-white font-bold text-xs flex items-center justify-center gap-2 shadow-lg'
        }
      >
        {compact ? (
          <Smartphone className="w-3.5 h-3.5 text-[#f97316]" />
        ) : (
          <Download className="w-4 h-4" />
        )}
        <span>{compact ? 'Install App' : 'Install SectionLine KS App (Offline Ready)'}</span>
      </button>

      {showIosGuide && (
        <div className="fixed inset-0 z-[700] bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center sm:p-4">
          <div className="animate-sheet-up w-full max-w-md bg-[#131810] border border-[#34422c] rounded-t-3xl sm:rounded-3xl p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-xl font-bold text-[#f4f1ea]">
                ADD TO HOME SCREEN
              </h3>
              <button
                type="button"
                onClick={() => setShowIosGuide(false)}
                className="w-9 h-9 rounded-full bg-[#1d2518] hover:bg-[#2a3623] text-[#d6cebc] flex items-center justify-center"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-[#d6cebc] leading-relaxed">
              Install SectionLine KS onto your phone so GPS, cached Kansas property lines, and saved warden slips open like a native app with zero cell signal.
            </p>
            <div className="space-y-2.5 text-xs bg-[#0e120b] border border-[#2d3826] rounded-2xl p-3.5">
              <div className="flex items-center gap-2.5 text-[#f4f1ea]">
                <Share className="w-4 h-4 text-[#f97316] shrink-0" />
                <span>
                  1. Tap the Safari <strong className="text-[#f97316]">Share</strong> button at the bottom of your screen.
                </span>
              </div>
              <div className="flex items-center gap-2.5 text-[#f4f1ea]">
                <PlusSquare className="w-4 h-4 text-[#84cc16] shrink-0" />
                <span>
                  2. Scroll down and tap <strong className="text-[#84cc16]">Add to Home Screen</strong>.
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowIosGuide(false)}
              className="w-full py-2.5 rounded-xl bg-[#ea580c] hover:bg-[#f97316] text-white font-bold text-xs"
            >
              Got It
            </button>
          </div>
        </div>
      )}
    </>
  );
};
