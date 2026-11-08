import { Component } from 'react'
import { ErrorState } from './states'

/**
 * Catches a render error in its subtree so one broken page shows a readable error instead of a blank screen.
 * "Try again" re-renders the children; changing `resetKey` (for example the current URL) clears the error too.
 */
export default class ErrorBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('Page crashed:', error, info?.componentStack)
  }

  componentDidUpdate(prevProps) {
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) this.reset()
  }

  reset = () => this.setState({ error: null })

  render() {
    if (this.state.error) {
      return <ErrorState title="Something went wrong" message={this.state.error.message} onRetry={this.reset} />
    }
    return this.props.children
  }
}
