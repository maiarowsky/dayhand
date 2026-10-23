package dev.helm.planner.auth

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PlanSwitchTest {
    private val old = "https://old-one.convex.site"

    @Test
    fun aPhoneThatNeverHadAServerTakesItsPlanToTheFirstOne() {
        assertNull(PlanSwitch.check(null, "https://new-one.convex.site", tasks = 12, pending = 30))
    }

    @Test
    fun theSameServerAgainKeepsThePlanAndItsWaitingChanges() {
        assertNull(PlanSwitch.check(old, "https://old-one.convex.site/", tasks = 5, pending = 3))
        assertNull(PlanSwitch.check(old, "HTTPS://OLD-ONE.convex.site", tasks = 5, pending = 3))
        // The deployment URL people copy from the dashboard names the same server.
        assertNull(PlanSwitch.check(old, "https://old-one.convex.cloud", tasks = 5, pending = 3))
    }

    @Test
    fun anotherServerReplacesThePlan() {
        assertEquals(
            PlanReplace(old, "http://10.0.2.2:3211", tasks = 5, pending = 3),
            PlanSwitch.check(old, " http://10.0.2.2:3211/ ", tasks = 5, pending = 3),
        )
        assertEquals(PlanReplace(old, "https://new-one.convex.site", 0, 1), PlanSwitch.check(old, "https://new-one.convex.site", 0, 1))
    }

    @Test
    fun anEmptyPhoneNeedsNoQuestion() {
        assertNull(PlanSwitch.check(old, "https://new-one.convex.site", tasks = 0, pending = 0))
    }

    @Test
    fun aBadAddressIsLeftToPairing() {
        assertNull(PlanSwitch.check(old, "not an address", tasks = 5, pending = 0))
    }
}
