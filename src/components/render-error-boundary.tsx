import { Component, type ErrorInfo, type ReactNode } from "react";
import { RotateCw } from "lucide-react";
import { BrandMark } from "@/components/brand";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface Props {
  /**
   * "app" replaces the whole page. "region" replaces one part of a page, so the
   * chrome around it keeps working.
   */
  scope: "app" | "region";
  /** The boundary shows its children again when this value changes. */
  resetKey?: string | undefined;
  children: ReactNode;
}

interface State {
  failed: boolean;
  resetKey?: string | undefined;
}

/**
 * Shows a recovery screen when a child fails to render. React unmounts the
 * whole tree above a failed render, so without a boundary the page goes blank.
 * The boundary uses no router, provider, or backend state, so it still works
 * when those fail.
 */
export class RenderErrorBoundary extends Component<Props, State> {
  override state: State = { failed: false, resetKey: this.props.resetKey };

  static getDerivedStateFromError(): Partial<State> {
    return { failed: true };
  }

  static getDerivedStateFromProps(props: Props, state: State): State | null {
    // Leaving the failed screen, for example through navigation, clears the failure.
    return props.resetKey === state.resetKey
      ? null
      : { failed: false, resetKey: props.resetKey };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    // The console is the only place a developer can read the cause.
    console.error("Render failed.", error, info.componentStack);
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return <RecoveryScreen scope={this.props.scope} />;
  }
}

function RecoveryScreen({ scope }: { scope: Props["scope"] }) {
  const card = (
    <Card className="w-full max-w-md" role="alert">
      <CardHeader>
        <CardTitle>
          <h1 className="text-2xl font-semibold tracking-tight">
            Something went wrong
          </h1>
        </CardTitle>
        <CardDescription>
          Minsky could not show this screen. Everything you already sent is
          saved on the server. Text you had not sent yet may be lost.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <Button className="h-11" onClick={() => window.location.reload()}>
          <RotateCw aria-hidden="true" />
          Reload
        </Button>
        <p className="text-sm text-muted-foreground">
          If this keeps happening, tell a volunteer or the organizer.
        </p>
      </CardContent>
    </Card>
  );
  if (scope === "region") {
    return <div className="flex justify-center p-6">{card}</div>;
  }
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center border-b px-4 py-3 sm:px-6">
        <BrandMark />
      </header>
      <main className="flex flex-1 items-center justify-center px-6 py-12">
        {card}
      </main>
    </div>
  );
}
