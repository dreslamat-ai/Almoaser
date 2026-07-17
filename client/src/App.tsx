import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";
import Dashboard from "./pages/Dashboard";
import Tasks from "./pages/Tasks";
import Invoices from "./pages/Invoices";
import Subscription from "./pages/Subscription";
import AdminPanel from "./pages/AdminPanel";
import ERPNextDashboard from "./pages/ERPNextDashboard";
import AgentChat from "./pages/AgentChat";
import ChannelSettings from "./pages/ChannelSettings";
import AccountSettings from "./pages/AccountSettings";

function Router() {
  return (
    <Switch>
      <Route path="/" component={ERPNextDashboard} />
      <Route path="/home" component={Home} />
      <Route path="/dashboard" component={Dashboard} />
      <Route path="/tasks" component={Tasks} />
      <Route path="/invoices" component={Invoices} />
      <Route path="/subscription" component={Subscription} />
      <Route path="/admin" component={AdminPanel} />
      <Route path="/erp" component={ERPNextDashboard} />
      <Route path="/agent" component={AgentChat} />
      <Route path="/channels" component={ChannelSettings} />
      <Route path="/settings" component={AccountSettings} />
      <Route path="/404" component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
