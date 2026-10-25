package dev.helm.planner.auth

/**
 * Connecting to [newServer] would replace the plan of [oldServer] on the phone: its [tasks] go from the phone and
 * its [pending] changes are never sent.
 */
data class PlanReplace(val oldServer: String, val newServer: String, val tasks: Int, val pending: Int, val projects: Int = 0)

/**
 * The plan on a phone belongs to the server it was last paired with, also after Disconnect (the changes made then
 * wait for that server). Its tasks and waiting changes must not reach another server, which is another owner's
 * plan: pairing with one empties the phone first, after the user agreed. A phone that never had a server takes its
 * plan to the first one it pairs with.
 */
object PlanSwitch {
    /** What pairing with [address] would remove, or null when it removes nothing and needs no question. */
    fun check(planServer: String?, address: String, tasks: Int, pending: Int, projects: Int = 0): PlanReplace? {
        val old = planServer ?: return null
        val new = PairingInput.normalizeServerUrl(address) ?: return null
        if (sameServer(old, new) || (tasks == 0 && pending == 0 && projects == 0)) return null
        return PlanReplace(old, new, tasks, pending, projects)
    }

    /** Two HTTP actions URLs name one server; the host's case does not matter. */
    fun sameServer(a: String, b: String): Boolean = a.trimEnd('/').equals(b.trimEnd('/'), ignoreCase = true)
}
