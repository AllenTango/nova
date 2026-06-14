import { Component, type ErrorInfo, type ReactNode } from "react";
import { Box, Typography, Button } from "@mui/material";
import { T, FONT } from "../theme";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Top-level safety net. If a Tauri IPC call throws synchronously
 * during render (e.g. someone forgot to gate a query), we surface a
 * recoverable panel instead of leaving the whole tree blank.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[nova] React error boundary caught:", error, info);
  }

  reset = () => this.setState({ error: null });

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <Box
        sx={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          p: 4,
          background: T.dark.ink,
        }}
      >
        <Box sx={{ maxWidth: 560, color: T.dark.star }}>
          <Typography
            sx={{
              fontFamily: FONT.display,
              fontSize: "1.6rem",
              mb: 2,
              color: T.dark.nova,
            }}
          >
            出错了
          </Typography>
          <Typography
            variant="body2"
            sx={{
              color: T.dark.starDim,
              mb: 2,
              whiteSpace: "pre-wrap",
              fontFamily: FONT.mono,
              fontSize: "0.8rem",
            }}
          >
            {this.state.error.message}
          </Typography>
          <Button variant="outlined" onClick={this.reset}>
            重试
          </Button>
        </Box>
      </Box>
    );
  }
}
