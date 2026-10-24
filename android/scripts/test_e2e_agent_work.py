import contextlib
import importlib.util
import io
from pathlib import Path
import unittest
from unittest.mock import call, patch


spec = importlib.util.spec_from_file_location("e2e_agent_work", Path(__file__).with_name("e2e-agent-work.py"))
agent_work = importlib.util.module_from_spec(spec)
spec.loader.exec_module(agent_work)


class AgentWorkScriptTest(unittest.TestCase):
    def test_claim_holder_from_mcp_is_used_through_release(self):
        for holder in ("agent", "Research bot"):
            with self.subTest(holder=holder):
                self.run_claim_flow(holder)

    def run_claim_flow(self, holder):
        claim_text = f"agent: {holder} works until"

        def find(text=None, desc=None, timeout=None):
            if text and text.startswith("agent: "):
                self.assertEqual(claim_text, text)
                if timeout == 3:
                    raise RuntimeError("not on screen")
            return {"text": text or "", "content-desc": f"{desc or ''}. Waiting for 1 task"}

        replies = [
            {"id": "s1", "ref": 12},
            {"id": "s2", "ref": 14},
            {"id": "s3", "ref": 15},
            {"task": {"blockedReason": agent_work.REASON, "plan": agent_work.PLAN}},
        ]
        with contextlib.ExitStack() as stack:
            stack.enter_context(contextlib.redirect_stdout(io.StringIO()))
            stack.enter_context(patch.object(agent_work.sys, "argv", ["e2e-agent-work.py", "--apk", "test.apk"]))
            stack.enter_context(patch.object(agent_work.time, "sleep"))
            stack.enter_context(patch.object(agent_work.time, "strftime", return_value="120000"))
            for name in ("adb", "shell", "tap", "screenshot", "set_network", "log", "find_scrolling"):
                stack.enter_context(patch.object(agent_work, name))
            stack.enter_context(patch.object(agent_work.base, "configure"))
            stack.enter_context(patch.object(agent_work.base, "dayhand_cli", return_value="no claim"))
            cli = stack.enter_context(patch.object(agent_work, "cli_json", side_effect=replies))
            mcp = stack.enter_context(patch.object(agent_work.board, "mcp", return_value={"claimedBy": {"name": holder}}))
            finder = stack.enter_context(patch.object(agent_work, "find", side_effect=find))
            confirm = stack.enter_context(patch.object(agent_work, "confirm"))
            agent_work.main()

        mcp.assert_called_once_with("claim_task", taskId="s3", minutes=60)
        finder.assert_has_calls([call(text=claim_text), call(text=claim_text, timeout=3)], any_order=True)
        confirm.assert_called_once_with("End the claim", f"End the claim of {holder}?")
        self.assertEqual(call("show", "15"), cli.call_args)


if __name__ == "__main__":
    unittest.main()
