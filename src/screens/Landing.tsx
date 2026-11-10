import { type ReactNode, useEffect, useState } from "react";
import { Link } from "react-router";
import {
  ArrowRight,
  BookOpen,
  Clock,
  Lock,
} from "lucide-react";
import { BrandMark } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useMediaQuery } from "@/connected/hooks/useMediaQuery";
import type { Issue } from "@/connected/model";
import { signInPath } from "@/connected/navigation";
import { clockDuration } from "@/connected/ui";
import { StatusBadge } from "@/contestant/StatusBadge";
import { documentationUrl } from "@/lib/links";
import { cn } from "@/lib/utils";
import { Meta } from "@/components/meta";

const replyText = "On our way to table C7.";
const noteText = "Swap the DisplayPort cable first.";

/** Extra content under a demo activity entry. */
interface EntryDetail {
  kind: "reply" | "note" | "summary";
  text: string;
}

/** One stage of the example issue that the animated demo replays. */
interface Step {
  status: Issue["status"];
  /** The demo activity entry. */
  entry: { text: string; detail?: EntryDetail };
  /** Simulated seconds on the issue timer when this step happens. */
  at: number;
}

const steps: readonly Step[] = [
  {
    status: "open",
    entry: { text: "Team Blue Herons reported the issue." },
    at: 0,
  },
  {
    status: "claimed",
    entry: {
      text: "Ana claimed the issue.",
      detail: { kind: "reply", text: replyText },
    },
    at: 94,
  },
  {
    status: "escalated",
    entry: {
      text: "Ana asked Hardware for help. Ana stays the owner until a specialist accepts.",
      detail: { kind: "note", text: noteText },
    },
    at: 251,
  },
  {
    status: "resolved",
    entry: {
      text: "Ravi resolved the issue.",
      detail: { kind: "summary", text: "Summary: replaced the cable." },
    },
    at: 512,
  },
];

const lastStep = steps.length - 1;

/** A position only comes from `advance`, which keeps its step in range. */
function stepAt(index: number): Step {
  const step = steps[index];
  if (!step) throw new RangeError(`The demo has no step ${index}.`);
  return step;
}
const tickMs = 200;
const stepTicks = 12;
const holdTicks = 20;

/** The demo state: the current step and the ticks since it began. */
interface Position {
  step: number;
  tick: number;
}

const start: Position = { step: 0, tick: 0 };
const finished: Position = { step: lastStep, tick: 0 };

function advance({ step, tick }: Position): Position {
  const last = step === lastStep;
  if (tick + 1 < (last ? holdTicks : stepTicks)) return { step, tick: tick + 1 };
  return { step: last ? 0 : step + 1, tick: 0 };
}

/** The simulated seconds on the issue timer. It stops on the last step. */
function elapsedSeconds({ step, tick }: Position): number {
  const { at } = stepAt(step);
  const next = steps[step + 1];
  if (!next) return at;
  return at + ((next.at - at) * tick) / stepTicks;
}

/** Loops through the steps. With reduced motion it shows the resolved issue. */
function useDemoPosition(): Position {
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const [position, setPosition] = useState(start);
  useEffect(() => {
    if (reducedMotion) return;
    const timer = window.setInterval(() => setPosition(advance), tickMs);
    return () => window.clearInterval(timer);
  }, [reducedMotion]);
  return reducedMotion ? finished : position;
}

const statusDots: Record<Issue["status"], string> = {
  open: "bg-status-open",
  claimed: "bg-status-claimed",
  escalated: "bg-status-escalated",
  resolved: "bg-status-resolved",
};

/** The public landing page for signed-out visitors. */
export function Landing() {
  const position = useDemoPosition();
  return (
    <div className="w-full">
      <div className="relative isolate overflow-x-clip">
        <div
          aria-hidden="true"
          className="hero-backdrop pointer-events-none absolute inset-0 -z-10"
        />
        <header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-2 px-4 py-3 sm:px-6">
          <BrandMark />
          <div className="flex items-center gap-0.5 sm:gap-2">
            <Button asChild variant="ghost" className="px-3">
              <a href={documentationUrl}>Docs</a>
            </Button>
            <ThemeToggle />
            <Button asChild>
              <Link to={signInPath}>Sign in</Link>
            </Button>
          </div>
        </header>
        <section
          aria-labelledby="landing-title"
          className="mx-auto grid w-full max-w-6xl items-center gap-12 px-4 pt-10 pb-12 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,28rem)] lg:gap-16 lg:pt-14 lg:pb-16"
        >
          <div>
            <h1
              id="landing-title"
              className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl lg:text-6xl"
            >
              Contest problems, solved on the clock.
            </h1>
            <p className="mt-5 max-w-xl text-lg text-muted-foreground">
              Teams report technical problems. Volunteers claim them,
              specialists take handoffs, and the jury can award lost time back.
              Each issue keeps a timer from the moment a team reports it until
              staff resolve it.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Button asChild size="lg" className="h-11">
                <Link to={signInPath}>
                  Sign in
                  <ArrowRight />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="h-11">
                <a href={documentationUrl}>
                  <BookOpen />
                  Read the docs
                </a>
              </Button>
            </div>
            <p className="mt-4 text-sm text-muted-foreground">
              Organizers create every account. There is no public sign-up.
            </p>
          </div>
          <DemoCard position={position} />
        </section>
      </div>
    </div>
  );
}

/** A decorative issue that replays the lifecycle. Assistive technology skips it. */
function DemoCard({ position }: { position: Position }) {
  const { status } = stepAt(position.step);
  const resolved = status === "resolved";
  return (
    <Card aria-hidden="true" className="gap-0 overflow-hidden py-0 shadow-lg">
      <div className="border-b px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="font-mono text-sm text-muted-foreground">
              #0167
            </span>
            <Badge variant="secondary">Hardware</Badge>
          </div>
          <StatusBadge status={status} />
        </div>
        <p className="mt-3 font-medium">Monitor goes black every few minutes</p>
        <p className="mt-1 text-sm text-muted-foreground">
          <Meta>
            <span>Team Blue Herons</span>
            <span>Table C7</span>
          </Meta>
        </p>
      </div>
      <div
        className={cn(
          "flex items-center gap-3 border-b px-5 py-4",
          resolved && "text-status-resolved",
        )}
      >
        <Clock
          className={cn("size-5", !resolved && "motion-safe:animate-pulse")}
        />
        <span className="font-mono text-3xl tabular-nums">
          {clockDuration(elapsedSeconds(position) * 1000)}
        </span>
      </div>
      <ol className="grid gap-4 px-5 py-4">
        {steps.map((step, index) => (
          <li
            key={step.status}
            className={cn(
              "flex gap-3",
              "relative",
              index <= position.step
                ? "motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2"
                : // Hidden entries keep their space, so the card never changes height.
                  "invisible",
            )}
          >
            {index < steps.length - 1 && (
              // Joins this dot to the next one across the row gap.
              <span className="absolute top-3.5 -bottom-4 left-[3.5px] w-px bg-muted-foreground/40" />
            )}
            <span
              className={cn(
                "mt-1.5 size-2 shrink-0 rounded-full",
                statusDots[step.status],
              )}
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-3 text-sm">
                <p>{step.entry.text}</p>
                <span className="font-mono text-xs text-muted-foreground tabular-nums">
                  {clockDuration(step.at * 1000)}
                </span>
              </div>
              {step.entry.detail && (
                <div className="mt-2">
                  <EntryDetailView detail={step.entry.detail} />
                </div>
              )}
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
}

function EntryDetailView({ detail }: { detail: EntryDetail }) {
  switch (detail.kind) {
    case "reply":
      return <ReplyBubble>{detail.text}</ReplyBubble>;
    case "note":
      return <InternalNote>{detail.text}</InternalNote>;
    case "summary":
      return <p className="text-xs text-muted-foreground">{detail.text}</p>;
  }
}

/** A staff reply that the team can read. */
function ReplyBubble({ children }: { children: ReactNode }) {
  return (
    <p className="w-fit max-w-full rounded-2xl rounded-tl-sm bg-secondary px-3 py-2 text-sm text-secondary-foreground">
      {children}
    </p>
  );
}

/** A note on the amber striped surface that only staff can read. */
function InternalNote({ children }: { children: ReactNode }) {
  return (
    <div className="internal-surface rounded-lg border p-3 text-sm">
      <p className="flex items-center gap-1 text-xs font-medium text-amber-700 dark:text-amber-400">
        <Lock aria-hidden="true" className="size-3" />
        <Meta>
          <span>Internal note</span>
          <span className="font-normal opacity-80">staff only</span>
        </Meta>
      </p>
      <p className="mt-1">{children}</p>
    </div>
  );
}
