import React from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { NotificationsScreen } from "../screens/NotificationsScreen";
import { acknowledgeFuelAnomaly, getFuelAnomalyApprovals } from "../services/NotificationService";

jest.mock("../services/NotificationService", () => ({
  acknowledgeFuelAnomaly: jest.fn(),
  getFuelAnomalyApprovals: jest.fn(),
}));

jest.mock("../components/MobilePageHeader", () => ({
  MobilePageHeader: () => null,
}));

const mockedGetApprovals = jest.mocked(getFuelAnomalyApprovals);
const mockedAcknowledge = jest.mocked(acknowledgeFuelAnomaly);

const approval = {
  id: "fuel-approval-1",
  status: "OPEN",
  severity: "CRITICAL",
  efficiency: 2.4,
  rollingAverage: 6.8,
  note: "Operations reviewed the vehicle.",
  acknowledgedAt: null,
  vehicle: { plateNumber: "ABC-1234" },
};

function props(accessRole: "chiefMechanic" | "mechanic", onRefresh = jest.fn()) {
  return {
    accessRole,
    notifications: [],
    loading: false,
    error: null,
    onRefresh,
    onOpen: jest.fn(),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedGetApprovals.mockResolvedValue([approval]);
  mockedAcknowledge.mockResolvedValue(undefined);
});

test("renders the approval panel for Chief Mechanic and hides it from Mechanic", async () => {
  const chiefProps = props("chiefMechanic");
  const chiefView = await render(<NotificationsScreen {...chiefProps} />);

  expect(await chiefView.findByText("Critical Fuel Anomalies")).toBeTruthy();
  expect(await chiefView.findByText("ABC-1234 - Critical fuel anomaly")).toBeTruthy();
  expect(mockedGetApprovals).toHaveBeenCalledTimes(1);
  await chiefView.unmount();

  jest.clearAllMocks();
  const mechanicView = await render(<NotificationsScreen {...props("mechanic")} />);
  expect(mechanicView.queryByText("Critical Fuel Anomalies")).toBeNull();
  expect(mockedGetApprovals).not.toHaveBeenCalled();
});

test("hides the approval panel when the role changes from Chief Mechanic to Mechanic", async () => {
  const view = await render(<NotificationsScreen {...props("chiefMechanic")} />);

  expect(await view.findByText("Critical Fuel Anomalies")).toBeTruthy();
  expect(mockedGetApprovals).toHaveBeenCalledTimes(1);

  await view.rerender(<NotificationsScreen {...props("mechanic")} />);

  expect(view.queryByText("Critical Fuel Anomalies")).toBeNull();
  expect(mockedGetApprovals).toHaveBeenCalledTimes(1);
});

test("loads pending approvals when the role changes from Mechanic to Chief Mechanic", async () => {
  const view = await render(<NotificationsScreen {...props("mechanic")} />);

  expect(view.queryByText("Critical Fuel Anomalies")).toBeNull();
  expect(mockedGetApprovals).not.toHaveBeenCalled();

  await view.rerender(<NotificationsScreen {...props("chiefMechanic")} />);

  expect(await view.findByText("Critical Fuel Anomalies")).toBeTruthy();
  expect(await view.findByText("ABC-1234 - Critical fuel anomaly")).toBeTruthy();
  expect(mockedGetApprovals).toHaveBeenCalledTimes(1);
});

test("hides a pending approval response after the role changes to Mechanic", async () => {
  let finishRequest!: (items: typeof approval[]) => void;
  mockedGetApprovals.mockReturnValue(new Promise((resolve) => { finishRequest = resolve; }));
  const view = await render(<NotificationsScreen {...props("mechanic")} />);

  await view.rerender(<NotificationsScreen {...props("chiefMechanic")} />);
  expect(view.getByLabelText("Loading fuel approvals")).toBeTruthy();
  expect(mockedGetApprovals).toHaveBeenCalledTimes(1);

  await view.rerender(<NotificationsScreen {...props("mechanic")} />);
  expect(view.queryByText("Critical Fuel Anomalies")).toBeNull();
  await act(async () => finishRequest([approval]));

  expect(view.queryByText("Critical Fuel Anomalies")).toBeNull();
  expect(view.queryByText("ABC-1234 - Critical fuel anomaly")).toBeNull();
});

test("fetches fresh approvals when switching back to Chief Mechanic after a stale request", async () => {
  const freshApproval = {
    ...approval,
    id: "fresh-fuel-approval",
    vehicle: { plateNumber: "FRESH-5678" },
  };
  let finishStaleRequest!: (items: typeof approval[]) => void;
  mockedGetApprovals
    .mockReturnValueOnce(new Promise((resolve) => { finishStaleRequest = resolve; }))
    .mockResolvedValueOnce([freshApproval]);
  const view = await render(<NotificationsScreen {...props("chiefMechanic")} />);

  await view.rerender(<NotificationsScreen {...props("mechanic")} />);
  await act(async () => finishStaleRequest([approval]));
  expect(view.queryByText("ABC-1234 - Critical fuel anomaly")).toBeNull();

  await view.rerender(<NotificationsScreen {...props("chiefMechanic")} />);
  expect(await view.findByText("FRESH-5678 - Critical fuel anomaly")).toBeTruthy();
  expect(view.queryByText("ABC-1234 - Critical fuel anomaly")).toBeNull();
  expect(mockedGetApprovals).toHaveBeenCalledTimes(2);
});

test("ignores a stale approval error after a newer Chief Mechanic fetch succeeds", async () => {
  const freshApproval = {
    ...approval,
    id: "fresh-fuel-approval",
    vehicle: { plateNumber: "FRESH-5678" },
  };
  let rejectStaleRequest!: (error: Error) => void;
  mockedGetApprovals
    .mockReturnValueOnce(new Promise((_, reject) => { rejectStaleRequest = reject; }))
    .mockResolvedValueOnce([freshApproval]);
  const view = await render(<NotificationsScreen {...props("chiefMechanic")} />);

  await view.rerender(<NotificationsScreen {...props("mechanic")} />);
  await view.rerender(<NotificationsScreen {...props("chiefMechanic")} />);
  expect(await view.findByText("FRESH-5678 - Critical fuel anomaly")).toBeTruthy();
  expect(mockedGetApprovals).toHaveBeenCalledTimes(2);

  await act(async () => rejectStaleRequest(new Error("Stale approval request failed.")));

  expect(view.queryByRole("alert")).toBeNull();
  expect(view.getByText("FRESH-5678 - Critical fuel anomaly")).toBeTruthy();
});

test("ignores an older successful response after a newer approval fetch succeeds", async () => {
  const freshApproval = {
    ...approval,
    id: "fresh-fuel-approval",
    vehicle: { plateNumber: "FRESH-5678" },
  };
  let finishOldRequest!: (items: typeof approval[]) => void;
  mockedGetApprovals
    .mockReturnValueOnce(new Promise((resolve) => { finishOldRequest = resolve; }))
    .mockResolvedValueOnce([freshApproval]);
  const onRefresh = jest.fn().mockResolvedValue(undefined);
  const view = await render(<NotificationsScreen {...props("chiefMechanic", onRefresh)} />);

  expect(view.getByLabelText("Loading fuel approvals")).toBeTruthy();
  await act(async () => view.getByTestId("notifications-scroll-view").props.refreshControl.props.onRefresh());
  expect(await view.findByText("FRESH-5678 - Critical fuel anomaly")).toBeTruthy();

  await act(async () => finishOldRequest([approval]));

  expect(view.getByText("FRESH-5678 - Critical fuel anomaly")).toBeTruthy();
  expect(view.queryByText("ABC-1234 - Critical fuel anomaly")).toBeNull();
  expect(mockedGetApprovals).toHaveBeenCalledTimes(2);
});

test("acknowledges with the entered remark and refreshes approvals and notifications", async () => {
  const onRefresh = jest.fn().mockResolvedValue(undefined);
  const view = await render(<NotificationsScreen {...props("chiefMechanic", onRefresh)} />);

  const remarkInput = await view.findByPlaceholderText("Optional acknowledgment remark");
  await fireEvent.changeText(remarkInput, "  Checked by chief mechanic  ");
  await fireEvent.press(view.getByRole("button", { name: "Acknowledge anomaly" }));

  await waitFor(() => {
    expect(mockedAcknowledge).toHaveBeenCalledWith("fuel-approval-1", "Checked by chief mechanic");
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(mockedGetApprovals).toHaveBeenCalledTimes(2);
    expect(view.getByPlaceholderText("Optional acknowledgment remark").props.value).toBe("");
  });
});

test("trims acknowledgment remarks and omits a blank remark", async () => {
  const view = await render(<NotificationsScreen {...props("chiefMechanic")} />);

  const remarkInput = await view.findByPlaceholderText("Optional acknowledgment remark");
  await fireEvent.changeText(remarkInput, "   ");
  await fireEvent.press(view.getByRole("button", { name: "Acknowledge anomaly" }));

  await waitFor(() => {
    expect(mockedAcknowledge).toHaveBeenCalledWith("fuel-approval-1", undefined);
    expect(view.getByPlaceholderText("Optional acknowledgment remark").props.value).toBe("");
  });
});

test("clears only the acknowledged anomaly's remark and preserves other remarks", async () => {
  const secondApproval = {
    ...approval,
    id: "fuel-approval-2",
    vehicle: { plateNumber: "XYZ-7890" },
  };
  mockedGetApprovals.mockResolvedValue([approval, secondApproval]);
  const onRefresh = jest.fn().mockResolvedValue(undefined);
  const view = await render(<NotificationsScreen {...props("chiefMechanic", onRefresh)} />);

  await view.findByText("XYZ-7890 - Critical fuel anomaly");
  const remarkInputs = view.getAllByPlaceholderText("Optional acknowledgment remark");
  await fireEvent.changeText(remarkInputs[0], "First anomaly remark");
  await fireEvent.changeText(remarkInputs[1], "Second anomaly remark");

  const acknowledgeButtons = view.getAllByRole("button", { name: "Acknowledge anomaly" });
  await fireEvent.press(acknowledgeButtons[1]);

  await waitFor(() => {
    expect(mockedAcknowledge).toHaveBeenCalledWith("fuel-approval-2", "Second anomaly remark");
    expect(onRefresh).toHaveBeenCalledTimes(1);
    const updatedInputs = view.getAllByPlaceholderText("Optional acknowledgment remark");
    expect(updatedInputs[0].props.value).toBe("First anomaly remark");
    expect(updatedInputs[1].props.value).toBe("");
  });
});

test("removes an anomaly from pending approvals after acknowledgment refresh", async () => {
  mockedGetApprovals
    .mockResolvedValueOnce([approval])
    .mockResolvedValueOnce([{ ...approval, acknowledgedAt: "2026-11-14T00:00:00.000Z" }]);
  const onRefresh = jest.fn().mockResolvedValue(undefined);
  const view = await render(<NotificationsScreen {...props("chiefMechanic", onRefresh)} />);

  expect(await view.findByText("ABC-1234 - Critical fuel anomaly")).toBeTruthy();
  await fireEvent.press(view.getByRole("button", { name: "Acknowledge anomaly" }));

  await waitFor(() => {
    expect(mockedAcknowledge).toHaveBeenCalledWith("fuel-approval-1", undefined);
    expect(mockedGetApprovals).toHaveBeenCalledTimes(2);
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(view.queryByText("ABC-1234 - Critical fuel anomaly")).toBeNull();
    expect(view.getByText("No critical fuel approvals pending.")).toBeTruthy();
  });
});

test("keeps an anomaly pending and shows an error when acknowledgment fails", async () => {
  mockedAcknowledge.mockRejectedValue(new Error("Unable to acknowledge this anomaly."));
  const onRefresh = jest.fn().mockResolvedValue(undefined);
  const view = await render(<NotificationsScreen {...props("chiefMechanic", onRefresh)} />);

  expect(await view.findByText("ABC-1234 - Critical fuel anomaly")).toBeTruthy();
  await fireEvent.press(view.getByRole("button", { name: "Acknowledge anomaly" }));

  await waitFor(() => {
    expect(mockedAcknowledge).toHaveBeenCalledWith("fuel-approval-1", undefined);
    expect((view.getByRole("alert")).props.children).toBe("Unable to acknowledge this anomaly.");
    expect(view.getByText("ABC-1234 - Critical fuel anomaly")).toBeTruthy();
    expect(mockedGetApprovals).toHaveBeenCalledTimes(1);
    expect(onRefresh).not.toHaveBeenCalled();
    expect(view.getByRole("button", { name: "Acknowledge anomaly" }).props.disabled).not.toBe(true);
  });
});

test("allows retrying an acknowledgment after a timeout", async () => {
  mockedAcknowledge
    .mockRejectedValueOnce(new Error("Acknowledgment request timed out."))
    .mockResolvedValueOnce(undefined);
  const onRefresh = jest.fn().mockResolvedValue(undefined);
  const view = await render(<NotificationsScreen {...props("chiefMechanic", onRefresh)} />);

  await view.findByText("ABC-1234 - Critical fuel anomaly");
  await fireEvent.press(view.getByRole("button", { name: "Acknowledge anomaly" }));
  expect((await view.findByRole("alert")).props.children).toBe("Acknowledgment request timed out.");
  expect(view.getByRole("button", { name: "Acknowledge anomaly" }).props.disabled).not.toBe(true);

  await fireEvent.press(view.getByRole("button", { name: "Acknowledge anomaly" }));
  await waitFor(() => {
    expect(mockedAcknowledge).toHaveBeenCalledTimes(2);
    expect(mockedGetApprovals).toHaveBeenCalledTimes(2);
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(view.queryByRole("alert")).toBeNull();
    expect(view.getByRole("button", { name: "Acknowledge anomaly" }).props.disabled).not.toBe(true);
  });
});

test("clears the acknowledgment error when a retry starts", async () => {
  let finishRetry!: () => void;
  mockedAcknowledge
    .mockRejectedValueOnce(new Error("Previous acknowledgment failed."))
    .mockImplementationOnce(() => new Promise((resolve) => { finishRetry = resolve; }));
  const onRefresh = jest.fn().mockResolvedValue(undefined);
  const view = await render(<NotificationsScreen {...props("chiefMechanic", onRefresh)} />);

  await view.findByText("ABC-1234 - Critical fuel anomaly");
  await fireEvent.press(view.getByRole("button", { name: "Acknowledge anomaly" }));
  expect((await view.findByRole("alert")).props.children).toBe("Previous acknowledgment failed.");

  await fireEvent.press(view.getByRole("button", { name: "Acknowledge anomaly" }));
  expect(view.queryByRole("alert")).toBeNull();
  expect(view.getByRole("button", { name: "Saving..." })).toBeTruthy();
  expect(mockedAcknowledge).toHaveBeenCalledTimes(2);

  await act(async () => finishRetry());
  await waitFor(() => {
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(mockedGetApprovals).toHaveBeenCalledTimes(2);
  });
});

test("ignores repeated acknowledgment taps while the request is pending", async () => {
  let finishAcknowledgment!: () => void;
  mockedAcknowledge.mockReturnValue(new Promise((resolve) => { finishAcknowledgment = resolve; }));
  const onRefresh = jest.fn().mockResolvedValue(undefined);
  const view = await render(<NotificationsScreen {...props("chiefMechanic", onRefresh)} />);

  await view.findByText("ABC-1234 - Critical fuel anomaly");
  await fireEvent.press(view.getByRole("button", { name: "Acknowledge anomaly" }));
  expect(view.getByRole("button", { name: "Saving..." })).toBeTruthy();
  await fireEvent.press(view.getByRole("button", { name: "Saving..." }));
  expect(mockedAcknowledge).toHaveBeenCalledTimes(1);
  expect(onRefresh).not.toHaveBeenCalled();

  await act(async () => finishAcknowledgment());
  await waitFor(() => {
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(mockedGetApprovals).toHaveBeenCalledTimes(2);
    expect(view.getByRole("button", { name: "Acknowledge anomaly" }).props.disabled).not.toBe(true);
  });
});

test("keeps other anomaly acknowledgment buttons available while one request is pending", async () => {
  const secondApproval = {
    ...approval,
    id: "fuel-approval-2",
    vehicle: { plateNumber: "XYZ-7890" },
  };
  const finishAcknowledgments: Record<string, () => void> = {};
  mockedGetApprovals.mockResolvedValue([approval, secondApproval]);
  mockedAcknowledge.mockImplementation((id) => new Promise((resolve) => {
    finishAcknowledgments[id] = resolve;
  }));
  const onRefresh = jest.fn().mockResolvedValue(undefined);
  const view = await render(<NotificationsScreen {...props("chiefMechanic", onRefresh)} />);

  await view.findByText("XYZ-7890 - Critical fuel anomaly");
  await fireEvent.press(view.getAllByRole("button", { name: "Acknowledge anomaly" })[0]);
  expect(view.getByRole("button", { name: "Saving..." })).toBeTruthy();

  const remainingButton = view.getByRole("button", { name: "Acknowledge anomaly" });
  expect(remainingButton).toBeTruthy();
  await fireEvent.press(remainingButton);
  expect(mockedAcknowledge.mock.calls.map(([id]) => id)).toEqual(["fuel-approval-1", "fuel-approval-2"]);

  await act(async () => {
    finishAcknowledgments["fuel-approval-1"]();
    finishAcknowledgments["fuel-approval-2"]();
  });
  await waitFor(() => {
    expect(mockedGetApprovals).toHaveBeenCalledTimes(3);
    expect(onRefresh).toHaveBeenCalledTimes(2);
  });
});

test("tracks saving state separately for concurrent anomaly acknowledgments", async () => {
  const secondApproval = {
    ...approval,
    id: "fuel-approval-2",
    vehicle: { plateNumber: "XYZ-7890" },
  };
  const finishAcknowledgments: Record<string, () => void> = {};
  mockedGetApprovals.mockResolvedValue([approval, secondApproval]);
  mockedAcknowledge.mockImplementation((id) => new Promise((resolve) => {
    finishAcknowledgments[id] = resolve;
  }));
  const view = await render(<NotificationsScreen {...props("chiefMechanic")} />);

  await view.findByText("XYZ-7890 - Critical fuel anomaly");
  const buttons = view.getAllByRole("button", { name: "Acknowledge anomaly" });
  await fireEvent.press(buttons[0]);
  await fireEvent.press(view.getAllByRole("button", { name: "Acknowledge anomaly" })[0]);

  expect(view.getAllByRole("button", { name: "Saving..." })).toHaveLength(2);
  expect(mockedAcknowledge.mock.calls.map(([id]) => id)).toEqual(["fuel-approval-1", "fuel-approval-2"]);

  await act(async () => finishAcknowledgments["fuel-approval-1"]());
  await waitFor(() => {
    expect(view.getAllByRole("button", { name: "Saving..." })).toHaveLength(1);
    expect(view.getAllByRole("button", { name: "Acknowledge anomaly" })).toHaveLength(1);
  });

  await act(async () => finishAcknowledgments["fuel-approval-2"]());
  await waitFor(() => {
    expect(view.queryAllByRole("button", { name: "Saving..." })).toHaveLength(0);
    expect(view.getAllByRole("button", { name: "Acknowledge anomaly" })).toHaveLength(2);
  });
});

test("keeps another anomaly saving when one concurrent acknowledgment fails", async () => {
  const secondApproval = {
    ...approval,
    id: "fuel-approval-2",
    vehicle: { plateNumber: "XYZ-7890" },
  };
  const pending: Record<string, { resolve: () => void; reject: (error: Error) => void }> = {};
  mockedGetApprovals.mockResolvedValue([approval, secondApproval]);
  mockedAcknowledge.mockImplementation((id) => new Promise((resolve, reject) => {
    pending[id] = { resolve, reject };
  }));
  const onRefresh = jest.fn().mockResolvedValue(undefined);
  const view = await render(<NotificationsScreen {...props("chiefMechanic", onRefresh)} />);

  await view.findByText("XYZ-7890 - Critical fuel anomaly");
  await fireEvent.changeText(view.getAllByPlaceholderText("Optional acknowledgment remark")[1], "Second anomaly remark");
  await fireEvent.press(view.getAllByRole("button", { name: "Acknowledge anomaly" })[0]);
  await fireEvent.press(view.getByRole("button", { name: "Acknowledge anomaly" }));

  await act(async () => pending["fuel-approval-1"].reject(new Error("First acknowledgment failed.")));
  await waitFor(() => {
    expect((view.getByRole("alert")).props.children).toBe("First acknowledgment failed.");
    expect(view.getAllByRole("button", { name: "Saving..." })).toHaveLength(1);
    expect(view.getAllByRole("button", { name: "Acknowledge anomaly" })).toHaveLength(1);
    expect(view.getAllByPlaceholderText("Optional acknowledgment remark")[1].props.value).toBe("Second anomaly remark");
    expect(onRefresh).not.toHaveBeenCalled();
  });

  await act(async () => pending["fuel-approval-2"].resolve());
  await waitFor(() => {
    expect(view.queryAllByRole("button", { name: "Saving..." })).toHaveLength(0);
    expect(view.getAllByRole("button", { name: "Acknowledge anomaly" })).toHaveLength(2);
    expect(mockedGetApprovals).toHaveBeenCalledTimes(2);
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});

test("shows a loading indicator while fuel approvals are being fetched", async () => {
  let finishRequest!: (items: typeof approval[]) => void;
  mockedGetApprovals.mockReturnValue(new Promise((resolve) => { finishRequest = resolve; }));
  const view = await render(<NotificationsScreen {...props("chiefMechanic")} />);

  expect(view.getByLabelText("Loading fuel approvals")).toBeTruthy();
  expect(view.queryByText("No critical fuel approvals pending.")).toBeNull();

  await act(async () => finishRequest([approval]));
  expect(await view.findByText("ABC-1234 - Critical fuel anomaly")).toBeTruthy();
  expect(view.queryByLabelText("Loading fuel approvals")).toBeNull();
});

test("shows the API error and hides the empty state when approvals fail to load", async () => {
  mockedGetApprovals.mockRejectedValue(new Error("Fuel approvals are unavailable."));
  const view = await render(<NotificationsScreen {...props("chiefMechanic")} />);

  expect((await view.findByRole("alert")).props.children).toBe("Fuel approvals are unavailable.");
  expect(view.queryByText("No critical fuel approvals pending.")).toBeNull();
  expect(view.queryByText("ABC-1234 - Critical fuel anomaly")).toBeNull();
});

test("keeps previously loaded approvals visible when a refresh fails", async () => {
  mockedGetApprovals
    .mockResolvedValueOnce([approval])
    .mockRejectedValueOnce(new Error("Unable to refresh fuel approvals."));
  const onRefresh = jest.fn().mockResolvedValue(undefined);
  const view = await render(<NotificationsScreen {...props("chiefMechanic", onRefresh)} />);

  expect(await view.findByText("ABC-1234 - Critical fuel anomaly")).toBeTruthy();
  await act(async () => view.getByTestId("notifications-scroll-view").props.refreshControl.props.onRefresh());

  await waitFor(() => {
    expect((view.getByRole("alert")).props.children).toBe("Unable to refresh fuel approvals.");
    expect(view.getByText("ABC-1234 - Critical fuel anomaly")).toBeTruthy();
    expect(view.queryByText("No critical fuel approvals pending.")).toBeNull();
    expect(mockedGetApprovals).toHaveBeenCalledTimes(2);
  });
});

test("replaces displayed approvals with the latest results after a successful refresh", async () => {
  const latestApproval = {
    ...approval,
    id: "latest-fuel-approval",
    vehicle: { plateNumber: "LATEST-5678" },
  };
  mockedGetApprovals
    .mockResolvedValueOnce([approval])
    .mockResolvedValueOnce([latestApproval]);
  const onRefresh = jest.fn().mockResolvedValue(undefined);
  const view = await render(<NotificationsScreen {...props("chiefMechanic", onRefresh)} />);

  expect(await view.findByText("ABC-1234 - Critical fuel anomaly")).toBeTruthy();
  await act(async () => view.getByTestId("notifications-scroll-view").props.refreshControl.props.onRefresh());

  expect(await view.findByText("LATEST-5678 - Critical fuel anomaly")).toBeTruthy();
  expect(view.queryByText("ABC-1234 - Critical fuel anomaly")).toBeNull();
  expect(mockedGetApprovals).toHaveBeenCalledTimes(2);
  expect(onRefresh).toHaveBeenCalledTimes(1);
});

test("shows the empty state when a successful refresh returns no pending approvals", async () => {
  mockedGetApprovals
    .mockResolvedValueOnce([approval])
    .mockResolvedValueOnce([]);
  const onRefresh = jest.fn().mockResolvedValue(undefined);
  const view = await render(<NotificationsScreen {...props("chiefMechanic", onRefresh)} />);

  expect(await view.findByText("ABC-1234 - Critical fuel anomaly")).toBeTruthy();
  await act(async () => view.getByTestId("notifications-scroll-view").props.refreshControl.props.onRefresh());

  expect(await view.findByText("No critical fuel approvals pending.")).toBeTruthy();
  expect(view.queryByText("ABC-1234 - Critical fuel anomaly")).toBeNull();
  expect(mockedGetApprovals).toHaveBeenCalledTimes(2);
  expect(onRefresh).toHaveBeenCalledTimes(1);
});

test("excludes resolved and acknowledged anomalies after a successful refresh", async () => {
  mockedGetApprovals
    .mockResolvedValueOnce([approval])
    .mockResolvedValueOnce([
      { ...approval, id: "resolved", status: "RESOLVED", vehicle: { plateNumber: "RESOLVED-123" } },
      { ...approval, id: "acknowledged", acknowledgedAt: "2026-11-14T00:00:00.000Z", vehicle: { plateNumber: "ACKED-456" } },
    ]);
  const view = await render(<NotificationsScreen {...props("chiefMechanic")} />);

  expect(await view.findByText("ABC-1234 - Critical fuel anomaly")).toBeTruthy();
  await act(async () => view.getByTestId("notifications-scroll-view").props.refreshControl.props.onRefresh());

  expect(await view.findByText("No critical fuel approvals pending.")).toBeTruthy();
  expect(view.queryByText("RESOLVED-123 - Critical fuel anomaly")).toBeNull();
  expect(view.queryByText("ACKED-456 - Critical fuel anomaly")).toBeNull();
});

test("shows the empty state when returned anomalies are acknowledged or noncritical", async () => {
  mockedGetApprovals.mockResolvedValue([
    { ...approval, id: "acknowledged", acknowledgedAt: "2026-11-14T00:00:00.000Z" },
    { ...approval, id: "noncritical", severity: "ESCALATED", vehicle: { plateNumber: "XYZ-7890" } },
  ]);
  const view = await render(<NotificationsScreen {...props("chiefMechanic")} />);

  expect(await view.findByText("No critical fuel approvals pending.")).toBeTruthy();
  expect(view.queryByText("ABC-1234 - Critical fuel anomaly")).toBeNull();
  expect(view.queryByText("XYZ-7890 - Critical fuel anomaly")).toBeNull();
});

test("retries a failed approval request on pull-to-refresh", async () => {
  mockedGetApprovals
    .mockRejectedValueOnce(new Error("Fuel approvals are unavailable."))
    .mockResolvedValueOnce([approval]);
  const onRefresh = jest.fn().mockResolvedValue(undefined);
  const view = await render(<NotificationsScreen {...props("chiefMechanic", onRefresh)} />);

  expect((await view.findByRole("alert")).props.children).toBe("Fuel approvals are unavailable.");
  const scrollView = view.getByTestId("notifications-scroll-view");
  await act(async () => scrollView.props.refreshControl.props.onRefresh());

  await waitFor(() => {
    expect(mockedGetApprovals).toHaveBeenCalledTimes(2);
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(view.queryByRole("alert")).toBeNull();
    expect(view.getByText("ABC-1234 - Critical fuel anomaly")).toBeTruthy();
  });
});

test("reloads pending critical approvals after notifications refresh successfully", async () => {
  const sequence: string[] = [];
  mockedGetApprovals.mockImplementation(async () => {
    sequence.push("approvals");
    return sequence.filter((item) => item === "approvals").length === 1 ? [] : [approval];
  });
  const onRefresh = jest.fn(async () => { sequence.push("notifications"); });
  const view = await render(<NotificationsScreen {...props("chiefMechanic", onRefresh)} />);

  expect(await view.findByText("No critical fuel approvals pending.")).toBeTruthy();
  await act(async () => view.getByTestId("notifications-scroll-view").props.refreshControl.props.onRefresh());

  await waitFor(() => {
    expect(sequence).toEqual(["approvals", "notifications", "approvals"]);
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(view.getByText("ABC-1234 - Critical fuel anomaly")).toBeTruthy();
    expect(view.getByTestId("notifications-scroll-view").props.refreshControl.props.refreshing).toBe(false);
  });
});

test("refreshes notifications without requesting fuel approvals for Mechanic", async () => {
  const onRefresh = jest.fn().mockResolvedValue(undefined);
  const view = await render(<NotificationsScreen {...props("mechanic", onRefresh)} />);

  expect(mockedGetApprovals).not.toHaveBeenCalled();
  await act(async () => view.getByTestId("notifications-scroll-view").props.refreshControl.props.onRefresh());

  await waitFor(() => {
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(mockedGetApprovals).not.toHaveBeenCalled();
    expect(view.getByTestId("notifications-scroll-view").props.refreshControl.props.refreshing).toBe(false);
  });
});

test("keeps the approval error visible and ends refresh state when retry fails", async () => {
  mockedGetApprovals
    .mockRejectedValueOnce(new Error("Initial approval request failed."))
    .mockRejectedValueOnce(new Error("Retry approval request failed."));
  const onRefresh = jest.fn().mockResolvedValue(undefined);
  const onLoadingChange = jest.fn();
  const view = await render(
    <NotificationsScreen {...props("chiefMechanic", onRefresh)} onLoadingChange={onLoadingChange} />,
  );

  expect((await view.findByRole("alert")).props.children).toBe("Initial approval request failed.");
  const scrollView = view.getByTestId("notifications-scroll-view");
  await act(async () => scrollView.props.refreshControl.props.onRefresh());

  await waitFor(() => {
    expect(mockedGetApprovals).toHaveBeenCalledTimes(2);
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect((view.getByRole("alert")).props.children).toBe("Retry approval request failed.");
    expect(view.queryByText("No critical fuel approvals pending.")).toBeNull();
    expect(view.getByTestId("notifications-scroll-view").props.refreshControl.props.refreshing).toBe(false);
    expect(onLoadingChange).toHaveBeenCalledWith(true);
    expect(onLoadingChange).toHaveBeenLastCalledWith(false);
  });
});

test("ends pull-to-refresh state when notification refresh rejects", async () => {
  const onRefresh = jest.fn().mockRejectedValue(new Error("Unable to refresh notifications."));
  const onLoadingChange = jest.fn();
  const view = await render(
    <NotificationsScreen {...props("chiefMechanic", onRefresh)} onLoadingChange={onLoadingChange} />,
  );

  await view.findByText("ABC-1234 - Critical fuel anomaly");
  const scrollView = view.getByTestId("notifications-scroll-view");
  await act(async () => scrollView.props.refreshControl.props.onRefresh());

  await waitFor(() => {
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(view.getByTestId("notifications-scroll-view").props.refreshControl.props.refreshing).toBe(false);
    expect(onLoadingChange).toHaveBeenCalledWith(true);
    expect(onLoadingChange).toHaveBeenLastCalledWith(false);
  });
});

test("ignores a second pull-to-refresh gesture while the first refresh is pending", async () => {
  let finishRefresh!: () => void;
  const onRefresh = jest.fn(() => new Promise<void>((resolve) => { finishRefresh = resolve; }));
  const onLoadingChange = jest.fn();
  const view = await render(
    <NotificationsScreen {...props("chiefMechanic", onRefresh)} onLoadingChange={onLoadingChange} />,
  );
  await view.findByText("ABC-1234 - Critical fuel anomaly");

  const refresh = () => view.getByTestId("notifications-scroll-view").props.refreshControl.props.onRefresh();
  await act(async () => refresh());
  await act(async () => refresh());

  expect(onRefresh).toHaveBeenCalledTimes(1);
  expect(onLoadingChange.mock.calls.filter(([loading]) => loading === true)).toHaveLength(1);
  expect(view.getByTestId("notifications-scroll-view").props.refreshControl.props.refreshing).toBe(true);
  expect(mockedGetApprovals).toHaveBeenCalledTimes(1);

  await act(async () => finishRefresh());
  await waitFor(() => {
    expect(mockedGetApprovals).toHaveBeenCalledTimes(2);
    expect(view.getByTestId("notifications-scroll-view").props.refreshControl.props.refreshing).toBe(false);
    expect(onLoadingChange).toHaveBeenLastCalledWith(false);
  });
});
