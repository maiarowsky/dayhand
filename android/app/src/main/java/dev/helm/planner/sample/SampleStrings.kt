package dev.helm.planner.sample

import androidx.annotation.StringRes
import dev.helm.planner.R

/** The string of each word of the sample plan (`strings_sample.xml`, in English and Polish). */
@StringRes
fun SampleText.stringRes(): Int = when (this) {
    SampleText.PLAN_WEEK -> R.string.sample_plan_week
    SampleText.PLAN_WEEK_RESUME -> R.string.sample_plan_week_resume
    SampleText.BILL -> R.string.sample_bill
    SampleText.REPLY -> R.string.sample_reply
    SampleText.DENTIST -> R.string.sample_dentist
    SampleText.STANDUP -> R.string.sample_standup
    SampleText.GROCERIES -> R.string.sample_groceries
    SampleText.MILK -> R.string.sample_milk
    SampleText.EGGS -> R.string.sample_eggs
    SampleText.BREAD -> R.string.sample_bread
    SampleText.COFFEE -> R.string.sample_coffee
    SampleText.PLANTS -> R.string.sample_plants
    SampleText.RUN -> R.string.sample_run
    SampleText.PROPOSAL -> R.string.sample_proposal
    SampleText.PROPOSAL_NOTE -> R.string.sample_proposal_note
    SampleText.LINK_TITLE -> R.string.sample_link_title
    SampleText.HOLIDAY -> R.string.sample_holiday
    SampleText.HOLIDAY_NOTE -> R.string.sample_holiday_note
    SampleText.MONDAY -> R.string.sample_monday
    SampleText.TUESDAY -> R.string.sample_tuesday
    SampleText.WEDNESDAY -> R.string.sample_wednesday
    SampleText.THURSDAY -> R.string.sample_thursday
    SampleText.FRIDAY -> R.string.sample_friday
    SampleText.SATURDAY -> R.string.sample_saturday
    SampleText.SUNDAY -> R.string.sample_sunday
    SampleText.HOME -> R.string.sample_home
    SampleText.WORK -> R.string.sample_work
    SampleText.HEALTH -> R.string.sample_health
}
