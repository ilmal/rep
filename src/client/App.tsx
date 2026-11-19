import { Component, type ReactNode, useEffect, useState } from 'react';
import { restoreSession } from './store/sync';
import { signInPromptSkipped } from './lib/signin-skip';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { getState, setState, useStore } from './store/core';
import { useActiveSession, useSessions } from './store/actions';
import Loading from './screens/Loading';
import ErrorGeneric from './screens/ErrorGeneric';
import Welcome from './screens/Welcome';
import OnboardGoal from './screens/OnboardGoal';
import OnboardGym from './screens/OnboardGym';
import OnboardAreas from './screens/OnboardAreas';
import Today from './screens/Today';
import PreSession from './screens/PreSession';
import GymPicker from './screens/GymPicker';
import Resume from './screens/Resume';
import WarmUp from './screens/WarmUp';
import Live from './screens/Live';
import SwapScreen from './screens/SwapScreen';
import SessionPlan from './screens/SessionPlan';
import Summary from './screens/Summary';
import EndEarly from './screens/EndEarly';
import Plan from './screens/Plan';
import AreaEdit from './screens/AreaEdit';
import Library from './screens/Library';
import ExerciseDetail from './screens/ExerciseDetail';
import ExerciseEdit from './screens/ExerciseEdit';
import Gyms from './screens/Gyms';
import GymDetail from './screens/GymDetail';
import AddGym from './screens/AddGym';
import Progress from './screens/Progress';
import History from './screens/History';
import SessionDetail from './screens/SessionDetail';
import Settings from './screens/Settings';
import PwaHost from './pwa/PwaHost';
import SignIn from './screens/SignIn';
import InstallSheet from './screens/InstallSheet';
import NotifPrompt from './screens/NotifPrompt';
import LibraryList from './screens/LibraryList';
import LibraryFilters from './screens/LibraryFilters';
import Exclusions from './screens/Exclusions';
import PlannerSettings from './screens/PlannerSettings';
import ConnectCoach from './screens/ConnectCoach';
import StreakCelebrate from './screens/StreakCelebrate';
import Streak from './screens/Streak';
import Badges from './screens/Badges';
import HeartRate from './screens/HeartRate';

class Boundary extends Component<{ children: ReactNode }, { err: Error | null }> {
  state = { err: null as Error | null };
  static getDerivedStateFromError(err: Error) { return { err }; }
  render() { return this.state.err ? <ErrorGeneric error={this.state.err} onRetry={() => this.setState({ err: null })} /> : this.props.children; }
}

const PUBLIC = ['/welcome', '/onboarding', '/signin', '/install'];
const SESSION_ONLY = ['/session/warmup', '/session/live', '/session/plan', '/session/end', '/session/swap'];

function Guard({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const hydrated = useStore((s) => s.hydrated);
  const onboarded = useStore((s) => s.settings.onboarded);
  const wasSignedIn = useStore((s) => !!s.device.wasSignedIn);
  const token = useStore((s) => s.device.token);
  const [checked, setChecked] = useState(false);
  // remember on this origin that the app has been used: the landing page at / then forwards to the app
  useEffect(() => { if (hydrated && onboarded) { try { localStorage.setItem('rep.seen', '1'); } catch { /* storage blocked */ } } }, [hydrated, onboarded]);
  // signed in before but the token is gone: try the long-lived session cookie before asking to sign in again
  useEffect(() => {
    if (!hydrated || !wasSignedIn || token) { if (token) setChecked(false); return; }
    let alive = true;
    void restoreSession().finally(() => { if (alive) setChecked(true); });
    return () => { alive = false; };
  }, [hydrated, wasSignedIn, token]);
  const resumeShown = useStore((s) => s.device.resumeShown);
  const active = useActiveSession();
  const sessions = useSessions();
  if (!hydrated) return <Loading />;
  const isPublic = PUBLIC.some((p) => pathname.startsWith(p));
  if (onboarded && wasSignedIn && !token && !pathname.startsWith('/signin') && !pathname.startsWith('/install')) {
    if (!checked) return <Loading />;
    if (!signInPromptSkipped() && navigator.onLine) return <Navigate to="/signin" replace />;
  }
  if (!onboarded && !isPublic) return <Navigate to="/welcome" replace />;
  // after setup, SignIn ('Save progress') is offered once even though the user is already onboarded
  if (onboarded && isPublic && !pathname.startsWith('/signin') && !pathname.startsWith('/install')) return <Navigate to="/" replace />;
  if (active && !resumeShown && (pathname === '/' || pathname === '/session/preview')) return <Navigate to="/resume" replace />;
  if (!active && SESSION_ONLY.some((p) => pathname.startsWith(p))) {
    // A session that was *just* completed goes to its summary (the screen's own navigate races this redirect).
    // The most recently ended session decides: completed -> its summary, discarded -> home.
    const last = sessions.filter((x) => (x.status === 'completed' || x.status === 'discarded') && (x.endedAt ?? 0) > Date.now() - 15_000).sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))[0];
    return <Navigate to={last && last.status === 'completed' ? `/session/summary/${last.id}` : '/'} replace />;
  }
  return <>{children}</>;
}

export default function App() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  // Offer "resume" at most once per app load.
  useEffect(() => { if (pathname === '/resume') setState((s) => { s.device = { ...s.device, resumeShown: true }; }); }, [pathname]);
  void getState;
  return (
    <Boundary>
      <PwaHost />
      <Guard>
        <Routes>
          <Route path="/welcome" element={<Welcome />} />
          <Route path="/onboarding/goal" element={<OnboardGoal />} />
          <Route path="/onboarding/gyms" element={<OnboardGym />} />
          <Route path="/onboarding/areas" element={<OnboardAreas />} />
          <Route path="/" element={<Today />} />
          <Route path="/resume" element={<Resume />} />
          <Route path="/session/preview" element={<PreSession />} />
          <Route path="/session/gym" element={<GymPicker />} />
          <Route path="/session/warmup" element={<WarmUp />} />
          <Route path="/session/live" element={<Live />} />
          <Route path="/session/swap" element={<SwapScreen />} />
          <Route path="/session/plan" element={<SessionPlan />} />
          <Route path="/session/end" element={<EndEarly />} />
          <Route path="/session/summary/:id" element={<Summary />} />
          <Route path="/plan" element={<Plan />} />
          <Route path="/plan/area/:id" element={<AreaEdit />} />
          <Route path="/plan/planner" element={<PlannerSettings />} />
          <Route path="/library" element={<Library />} />
          <Route path="/library/all" element={<LibraryList />} />
          <Route path="/library/filters" element={<LibraryFilters />} />
          <Route path="/library/exclusions" element={<Exclusions />} />
          <Route path="/signin" element={<SignIn />} />
          <Route path="/install" element={<InstallSheet />} />
          <Route path="/notifications" element={<NotifPrompt />} />
          <Route path="/library/:id" element={<ExerciseDetail />} />
          <Route path="/exercise/new" element={<ExerciseEdit />} />
          <Route path="/exercise/:id/edit" element={<ExerciseEdit />} />
          <Route path="/gyms" element={<Gyms />} />
          <Route path="/gyms/new" element={<AddGym />} />
          <Route path="/gyms/:id" element={<GymDetail />} />
          <Route path="/progress" element={<Progress />} />
          <Route path="/history" element={<History />} />
          <Route path="/history/:id" element={<SessionDetail />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/settings/coach" element={<ConnectCoach />} />
          <Route path="/settings/heart-rate" element={<HeartRate />} />
          <Route path="/streak" element={<Streak />} />
          <Route path="/streak/badges" element={<Badges />} />
          <Route path="/streak/celebrate" element={<StreakCelebrate />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Guard>
    </Boundary>
  );
}
