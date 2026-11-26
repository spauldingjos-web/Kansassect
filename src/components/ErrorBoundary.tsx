import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: error?.message || 'Unexpected application error.',
    };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('SectionLine KS ErrorBoundary:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen w-screen bg-[#0c0f0a] text-[#f4f1ea] flex items-center justify-center p-6">
          <div className="w-full max-w-md bg-[#131810] border border-[#ea580c]/60 rounded-3xl p-6 space-y-4 shadow-2xl">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-2xl bg-[#ea580c]/20 border border-[#ea580c] flex items-center justify-center">
                <AlertTriangle className="w-6 h-6 text-[#f97316]" />
              </div>
              <div>
                <h2 className="font-display text-xl font-bold text-[#f4f1ea]">
                  Something Went Wrong
                </h2>
                <p className="text-xs text-[#b7ad96]">
                  SectionLine KS caught an unexpected error.
                </p>
              </div>
            </div>
            <p className="text-xs font-mono bg-[#0c0f0a] border border-[#2d3826] rounded-xl p-3 text-[#d6cebc] break-words">
              {this.state.message}
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="w-full py-2.5 px-4 rounded-xl bg-[#ea580c] hover:bg-[#f97316] text-white font-bold text-xs flex items-center justify-center gap-2"
            >
              <RotateCcw className="w-4 h-4" />
              <span>Reload SectionLine KS</span>
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
