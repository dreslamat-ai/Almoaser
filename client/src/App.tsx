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
import Team from "./pages/Team";
import ErpInvoices from "./pages/ErpInvoices";
import ErpCustomers from "./pages/ErpCustomers";
import ErpReports from "./pages/ErpReports";
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import PaymentCallback from "./pages/PaymentCallback";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/login" component={Login} />
      <Route path="/signup" component={Signup} />
      <Route path="/home" component={Home} />
      <Route path="/dashboard" component={Dashboard} />
      <Route path="/tasks" component={Tasks} />
      <Route path="/invoices" component={Invoices} />
      <Route path="/subscription" component={Subscription} />
      <Route path="/payment/callback" component={PaymentCallback} />
      <Route path="/admin" component={AdminPanel} />
      <Route path="/erp" component={ERPNextDashboard} />
      <Route path="/erp/invoices" component={ErpInvoices} />
      <Route path="/erp/customers" component={ErpCustomers} />
      <Route path="/erp/reports" component={ErpReports} />
      <Route path="/agent" component={AgentChat} />
      <Route path="/channels" component={ChannelSettings} />
      <Route path="/settings" component={AccountSettings} />
      <Route path="/team" component={Team} />
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
