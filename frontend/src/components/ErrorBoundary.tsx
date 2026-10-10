import { Component, type ErrorInfo, type ReactNode } from 'react'

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.warn('UI error captured by boundary', error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="page">
        <div className="error-block" role="alert">
          <div className="error-block-text">
            <div className="error-block-title">This view failed to render</div>
            <div className="error-block-msg">
              No action was executed by this failure. Other pages still work. Retry to reload this view.
            </div>
            <div className="error-block-meta mono">{this.state.error.message}</div>
          </div>
          <button type="button" className="btn btn-sm" onClick={() => this.setState({ error: null })}>
            Retry
          </button>
        </div>
      </div>
    )
  }
}
