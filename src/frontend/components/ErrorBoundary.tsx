import { Component, type ReactNode } from "react";
import { AlertCircle } from "lucide-react";
import { ReportIssueButton } from "./ReportIssueButton";

interface Props {
	children: ReactNode;
}

interface State {
	error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
	constructor(props: Props) {
		super(props);
		this.state = { error: null };
	}

	static getDerivedStateFromError(error: Error): State {
		return { error };
	}

	override render() {
		if (this.state.error) {
			return (
				<div className="flex min-h-screen flex-col items-center justify-center bg-background p-6 text-foreground">
					<div className="w-full max-w-lg rounded-xl border bg-card p-8 text-center shadow-sm">
						<div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-red-100 text-red-600">
							<AlertCircle className="h-8 w-8" />
						</div>
						<h1 className="text-2xl font-bold">Something went wrong</h1>
						<p className="mt-2 text-sm text-muted-foreground">
							The app encountered an unexpected error. You can report it to help
							us fix it.
						</p>
						<div className="mt-6 flex justify-center gap-3">
							<ReportIssueButton error={this.state.error} />
							<button
								type="button"
								onClick={() => window.location.reload()}
								className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
							>
								Reload App
							</button>
						</div>
						{this.state.error.stack && (
							<pre className="mt-6 max-h-48 overflow-auto rounded-md bg-muted p-3 text-left text-xs">
								{this.state.error.stack}
							</pre>
						)}
					</div>
				</div>
			);
		}

		return this.props.children;
	}
}
