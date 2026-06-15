import { Component, type ErrorInfo, type ReactNode } from "react";
import { Box, Typography, Button } from "@mui/material";
import { T, FONT } from "../theme";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/** 顶层安全网。如果 Tauri IPC 调用在 render 期间同步抛错（比如有人忘记 gate 一个 query），我们呈现一个可恢复面板，而不是让整棵树变白屏。 */
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
