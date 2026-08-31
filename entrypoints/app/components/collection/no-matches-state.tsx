import { StateBox } from './state-box';

export interface NoMatchesStateProps {
  /** Pre-translated "no matches" line — platform names its own item noun. */
  message: string;
}

/** Filters (search / facet / tag) matched nothing — dashed box, one readable
 *  line. Secondary ink, never the disabled shade: it is information. */
export function NoMatchesState({ message }: NoMatchesStateProps) {
  return <StateBox description={message} />;
}
