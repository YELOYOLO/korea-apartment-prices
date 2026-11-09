import { forwardRef, useId, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "ghost";
const VARIANTS: Record<Variant, string> = {
  primary: "bg-brand text-on-brand hover:bg-brand-hover",
  secondary: "border border-border-strong bg-surface text-text hover:bg-surface-muted",
  ghost: "text-text-secondary hover:bg-surface-muted",
};

export function buttonClass(variant: Variant = "primary", extra = "") {
  return `inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${VARIANTS[variant]} ${extra}`;
}

export function Button({ variant = "primary", className = "", ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button type="button" className={buttonClass(variant, className)} {...rest} />;
}

type Tone = "neutral" | "good" | "warning" | "danger" | "info" | "brand";
const TONES: Record<Tone, string> = {
  neutral: "bg-surface-muted text-text-secondary",
  good: "bg-good-soft text-good",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
  info: "bg-info-soft text-info",
  brand: "bg-brand-soft text-brand-text",
};

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${TONES[tone]}`}>{children}</span>;
}

const inputClass = "h-11 w-full rounded-lg border border-border bg-surface px-3 text-sm text-text outline-none focus:border-brand disabled:opacity-50";

function Field({ id, label, hint, required, children }: { id: string; label: ReactNode; hint?: ReactNode; required?: boolean; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
        {required && <span className="text-danger" aria-hidden> *</span>}
      </label>
      {children}
      {hint && <p id={`${id}-hint`} className="text-xs text-muted">{hint}</p>}
    </div>
  );
}

export const TextField = forwardRef<HTMLInputElement, { label: ReactNode; hint?: ReactNode } & InputHTMLAttributes<HTMLInputElement>>(function TextField(
  { label, hint, id, className = "", ...rest },
  ref,
) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <Field id={fid} label={label} hint={hint} required={rest.required}>
      <input ref={ref} id={fid} aria-describedby={hint ? `${fid}-hint` : undefined} className={`${inputClass} ${className}`} {...rest} />
    </Field>
  );
});

export function SelectField({ label, hint, id, children, ...rest }: { label: ReactNode; hint?: ReactNode; children: ReactNode } & SelectHTMLAttributes<HTMLSelectElement>) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <Field id={fid} label={label} hint={hint}>
      <select id={fid} className={inputClass} {...rest}>
        {children}
      </select>
    </Field>
  );
}

export function Loading({ rows = 2 }: { rows?: number }) {
  return (
    <div className="space-y-3" role="status" aria-label="불러오는 중">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-32 animate-pulse rounded-xl bg-surface-muted" />
      ))}
    </div>
  );
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-border-strong p-8 text-center">
      <p className="font-semibold">{title}</p>
      {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div role="alert" className="rounded-xl border border-danger bg-danger-soft p-4 text-sm text-danger">
      <p className="font-semibold">불러오지 못했습니다.</p>
      <p className="mt-1 break-words">{error instanceof Error ? error.message : String(error)}</p>
      {onRetry && (
        <Button variant="secondary" className="mt-3" onClick={onRetry}>
          다시 시도
        </Button>
      )}
    </div>
  );
}
