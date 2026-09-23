import { Component, type ErrorInfo, type ReactNode } from 'react';
import { DataIntegrityError } from '../api/apiClient';
import { trackFrontendException } from '../lib/performanceTelemetry';

type State = { error?: Error };

export class DataIntegrityBoundary extends Component<{ children: ReactNode }, State> {
  state: State = {};

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('TMS data boundary caught an error', error, info);
    trackFrontendException(error, error instanceof DataIntegrityError ? 'data-integrity-boundary' : 'react-boundary');
  }

  render() {
    const error = this.state.error;
    if (!error) return this.props.children;

    if (error instanceof DataIntegrityError) {
      return (
        <main className="data-problem-page">
          <section className="sign-in-panel data-problem-state" role="alert">
            <p className="eyebrow">Data problem</p>
            <h1>This screen received invalid operational data</h1>
            <p>
              The TMS has not substituted or invented missing values. The affected view has been stopped so the source data can be corrected safely.
            </p>
            <div className="data-problem-detail">
              <strong>Endpoint</strong>
              <code>{error.endpoint}</code>
              <strong>Validation</strong>
              <p>{error.summary || 'The response did not match its API contract.'}</p>
            </div>
            <button className="primary" type="button" onClick={() => window.location.reload()}>Retry screen</button>
          </section>
        </main>
      );
    }

    throw error;
  }
}
