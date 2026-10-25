"""Driver behavior only; project/server behavior is checked by the real-backend e2e."""
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

_spec = importlib.util.spec_from_file_location("e2e_projects", Path(__file__).with_name("e2e-projects.py"))
flow = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(flow)


class ProjectsDriverTest(unittest.TestCase):
    def test_back_closes_ime_then_form_and_stops_at_list(self):
        states = [[{"text": "Name"}], [{"text": "Name"}], [{"content-desc": "Set order"}]]
        backs = []
        with patch.object(flow.base, "ui_nodes", side_effect=states), patch.object(flow.base, "shell", side_effect=lambda *args: backs.append(args)), patch.object(flow.time, "sleep"):
            flow.dismiss_project_form()
        self.assertEqual([("input", "keyevent", "KEYCODE_BACK")] * 2, backs)

    def test_already_closed_form_does_not_navigate_back_again(self):
        with patch.object(flow.base, "ui_nodes", return_value=[{"content-desc": "Set order"}]), patch.object(flow.base, "shell") as shell:
            flow.dismiss_project_form()
        shell.assert_not_called()

    def test_stuck_form_reports_failure_instead_of_searching_hidden_rows(self):
        with patch.object(flow.base, "ui_nodes", return_value=[{"text": "Name"}]), patch.object(flow.base, "shell"), patch.object(flow.time, "sleep"):
            with self.assertRaisesRegex(RuntimeError, "did not close"):
                flow.dismiss_project_form()

    def test_failed_flow_attempts_diagnostic_png_and_preserves_original_error(self):
        args = ["e2e-projects.py", "--apk", "debug.apk", "--shots", "shots", "--server-url", "http://10.0.2.2:3211"]
        with patch.object(flow.sys, "argv", args), patch.object(flow, "run", side_effect=ValueError("flow failed")), patch.object(flow.base, "screenshot") as screenshot:
            with self.assertRaisesRegex(ValueError, "flow failed"):
                flow.main()
        screenshot.assert_called_once_with("shots", "project-e2e-failure.png")


if __name__ == "__main__":
    unittest.main()
