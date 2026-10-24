find_package(Qt6 REQUIRED COMPONENTS Test)

add_library(dayhand_testsupport STATIC FakeServer.cpp)
target_link_libraries(dayhand_testsupport PUBLIC dayhand_core)
target_include_directories(dayhand_testsupport PUBLIC ${CMAKE_CURRENT_SOURCE_DIR})

function(dayhand_test name)
    add_executable(${name} ${name}.cpp)
    target_link_libraries(${name} PRIVATE dayhand_testsupport Qt6::Test)
    target_compile_definitions(${name} PRIVATE DAYHAND_TEST_CASES_DIR="${CMAKE_CURRENT_SOURCE_DIR}/cases")
    add_test(NAME ${name} COMMAND ${name})
    set_tests_properties(${name} PROPERTIES ENVIRONMENT "QT_QPA_PLATFORM=offscreen;TZ=UTC")
endfunction()

dayhand_test(tst_dates)
dayhand_test(tst_recurrence)
dayhand_test(tst_rules)
dayhand_test(tst_merge)
dayhand_test(tst_pairing)
dayhand_test(tst_sync)

if(DAYHAND_BUILD_APP)
    add_subdirectory(app)
endif()
