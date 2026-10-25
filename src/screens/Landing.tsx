import { type ReactNode, useEffect, useState } from "react";
import { Link } from "react-router";
import {
  ArrowRight,
  BookOpen,
  Clock,
  Hand,
  Lock,
  Scale,
  UserCog,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { BrandMark } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useMediaQuery } from "@/connected/hooks/useMediaQuery";
import type { Issue } from "@/connected/model";
import { signInPath } from "@/connected/navigation";
import { clockDuration } from "@/connected/ui";
import { StatusBadge } from "@/contestant/StatusBadge";
import { documentationUrl } from "@/lib/links";
import { cn } from "@/lib/utils";

const replyText = "On our way to table C7.";
const noteText = "Swap the DisplayPort cable first.";

/** Extra content under a demo activity entry. */
interface EntryDetail {
  kind: "reply" | "note" | "summary";
  text: string;
}

/**
 * One stage of the example issue. The table drives both the animated demo
 * and the lifecycle rail, so the two cannot disagree.
 */
interface Step {
  status: Issue["status"];
  /** The lifecycle rail text. */
  summary: string;
  /** The demo activity entry. */
  entry: { text: string; detail?: EntryDetail };
  /** Simulated seconds on the issue timer when this step happens. */
  at: number;
}

const steps: readonly Step[] = [
  {
    status: "open",
    summary: "A team reports a problem. The timer starts.",
    entry: { text: "Team Blue Herons reported the issue." },
    at: 0,
  },
  {
    status: "claimed",
    summary: "A volunteer takes the issue and replies to the team.",
    entry: {
      text: "Ana claimed the issue.",
      detail: { kind: "reply", text: replyText },
    },
    at: 94,
  },
  {
    status: "escalated",
    summary:
      "A specialist accepts the handoff. The volunteer stays the owner until then.",
    entry: {
      text: "Ana asked Hardware for help. Ana stays the owner until a specialist accepts.",
      detail: { kind: "note", text: noteText },
    },
    at: 251,
  },
  {
    status: "resolved",
    summary: "The timer stops. The summary and every action stay in the history.",
    entry: {
      text: "Ravi resolved the issue.",
      detail: { kind: "summary", text: "Summary: replaced the cable." },
    },
    at: 512,
  },
];

const lastStep = steps.length - 1;
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
  const next = steps[step + 1];
  if (!next) return steps[step].at;
  return steps[step].at + ((next.at - steps[step].at) * tick) / stepTicks;
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

interface Audience {
  icon: LucideIcon;
  title: string;
  text: string;
}

const audiences: readonly Audience[] = [
  {
    icon: Hand,
    title: "Contestants",
    text: "Report a problem from your desk and follow replies from staff.",
  },
  {
    icon: Wrench,
    title: "Volunteers and specialists",
    text: "Work the shared queue from a phone or a desktop console.",
  },
  {
    icon: Scale,
    title: "Jury",
    text: "Award time for minutes a team lost. Staff then confirm that the contest clock applied it.",
  },
  {
    icon: UserCog,
    title: "Administrators",
    text: "Create accounts, assign roles, and set image limits for each session.",
  },
];

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
            <Badge variant="secondary">Contest help desk</Badge>
            <h1
              id="landing-title"
              className="mt-4 text-4xl font-semibold tracking-tight text-balance sm:text-5xl lg:text-6xl"
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
      <Section id="lifecycle-heading" title="How an issue moves">
        <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((step, index) => (
            <li
              key={step.status}
              data-active={index === position.step}
              className="relative overflow-hidden rounded-xl border bg-card p-5 text-card-foreground motion-safe:transition-[transform,box-shadow,border-color] data-[active=true]:border-foreground/30 data-[active=true]:shadow-md motion-safe:data-[active=true]:-translate-y-0.5"
            >
              <span
                aria-hidden="true"
                className={cn(
                  "absolute inset-x-0 top-0 h-1",
                  statusDots[step.status],
                )}
              />
              <StatusBadge status={step.status} />
              <p className="mt-3 text-sm text-muted-foreground">
                {step.summary}
              </p>
            </li>
          ))}
        </ol>
      </Section>
      <Section id="roles-heading" title="Who uses Minsky">
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {audiences.map(({ icon: Icon, title, text }) => (
            <li key={title}>
              <Card className="h-full">
                <CardContent>
                  <span className="grid size-9 place-items-center rounded-lg bg-secondary text-secondary-foreground">
                    <Icon aria-hidden="true" className="size-4" />
                  </span>
                  <h3 className="mt-4 font-semibold">{title}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{text}</p>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
        <Card className="mt-4">
          <CardContent className="grid items-center gap-6 md:grid-cols-2">
            <div>
              <h3 className="font-semibold">Replies and notes stay apart</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Teams see public replies. Only staff see internal notes and
                staff-only images.
              </p>
            </div>
            <div aria-hidden="true" className="grid gap-3">
              <ReplyBubble>{replyText}</ReplyBubble>
              <InternalNote>{noteText}</InternalNote>
            </div>
          </CardContent>
        </Card>
      </Section>
    </div>
  );
}

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={id}
      className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6 sm:py-16"
    >
      <h2
        id={id}
        className="mb-8 text-2xl font-semibold tracking-tight sm:text-3xl"
      >
        {title}
      </h2>
      {children}
    </section>
  );
}

/** A decorative issue that replays the lifecycle. Assistive technology skips it. */
function DemoCard({ position }: { position: Position }) {
  const resolved = steps[position.step].status === "resolved";
  return (
    <Card aria-hidden="true" className="gap-0 overflow-hidden py-0 shadow-lg">
      <div className="border-b px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="font-mono text-sm text-muted-foreground">
              #0142
            </span>
            <Badge variant="secondary">Hardware</Badge>
          </div>
          <StatusBadge status={steps[position.step].status} />
        </div>
        <p className="mt-3 font-medium">Monitor goes black every few minutes</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Team Blue Herons · Table C7
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
              index <= position.step
                ? "motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2"
                : // Hidden entries keep their space, so the card never changes height.
                  "invisible",
            )}
          >
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
        Internal note · staff only
      </p>
      <p className="mt-1">{children}</p>
    </div>
  );
}
