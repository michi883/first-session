import { TRACK_EVENTS, trackEvent } from "./pendo-tracking.js";
import { therapists } from "./therapists.js";

const searchForm = document.getElementById("search-form");
const queryInput = document.getElementById("query-input");
const locationFilter = document.getElementById("filter-location");
const specialtyFilter = document.getElementById("filter-specialty");
const insuranceFilter = document.getElementById("filter-insurance");
const ageRangeFilter = document.getElementById("filter-age-range");
const resultsContainer = document.getElementById("results");
const resultsSummary = document.getElementById("results-summary");

let previousResultsCount = therapists.length;

// --- Search ---

function getActiveFilters() {
  const filters = {};
  if (locationFilter.value) filters.location = locationFilter.value;
  if (specialtyFilter.value) filters.specialty = specialtyFilter.value;
  if (insuranceFilter.value) filters.insurance = insuranceFilter.value;
  if (ageRangeFilter.value) filters.age_range = ageRangeFilter.value;
  return filters;
}

function runSearch() {
  const query = queryInput.value.trim().toLowerCase();
  const filters = getActiveFilters();
  const results = therapists.filter((t) => {
    if (query && !t.name.toLowerCase().includes(query) &&
        !t.specialty.some((s) => s.toLowerCase().includes(query))) {
      return false;
    }
    if (filters.location && t.location !== filters.location) return false;
    if (filters.specialty && !t.specialty.includes(filters.specialty)) return false;
    if (filters.insurance && !t.insurance.includes(filters.insurance)) return false;
    if (filters.age_range && t.ageRange !== filters.age_range) return false;
    return true;
  });

  renderResults(results);

  const filtersApplied = Object.keys(filters);

  // Track: therapist_search_executed
  trackEvent(TRACK_EVENTS.THERAPIST_SEARCH_EXECUTED, {
    query: query || "",
    filters_applied: filtersApplied.join(","),
    results_count: results.length,
    insurance_type: filters.insurance || "",
    age_range: filters.age_range || "",
    specialty: filters.specialty || "",
    location: filters.location || "",
    search_type: query ? "keyword" : "browse",
  });

  // Track: search_no_results (when zero results)
  if (results.length === 0) {
    trackEvent(TRACK_EVENTS.SEARCH_NO_RESULTS, {
      query: query || "",
      filters_applied: filtersApplied.join(","),
      insurance_type: filters.insurance || "",
      age_range: filters.age_range || "",
      specialty: filters.specialty || "",
      location: filters.location || "",
    });
  }

  previousResultsCount = results.length;
}

searchForm.addEventListener("submit", function (e) {
  e.preventDefault();
  runSearch();
});

// --- Filters ---

function handleFilterChange(filterType, filterValue) {
  const prevCount = previousResultsCount;
  runSearch();

  const filters = getActiveFilters();
  const totalActive = Object.keys(filters).length;

  // Track: search_filters_applied
  trackEvent(TRACK_EVENTS.SEARCH_FILTERS_APPLIED, {
    filter_type: filterType,
    filter_value: filterValue || "cleared",
    total_filters_active: totalActive,
    results_count_after_filter: previousResultsCount,
    previous_results_count: prevCount,
  });
}

locationFilter.addEventListener("change", function () {
  handleFilterChange("location", this.value);
});
specialtyFilter.addEventListener("change", function () {
  handleFilterChange("specialty", this.value);
});
insuranceFilter.addEventListener("change", function () {
  handleFilterChange("insurance", this.value);
});
ageRangeFilter.addEventListener("change", function () {
  handleFilterChange("age_range", this.value);
});

// --- Contact paths ---

function handleContactClick(contactType, therapist, position, e) {
  // Track: contact_path_initiated
  trackEvent(TRACK_EVENTS.CONTACT_PATH_INITIATED, {
    contact_type: contactType,
    therapist_id: therapist.id,
    therapist_name: therapist.name,
    organization_name: therapist.intakeOrganization
      ? therapist.intakeOrganization.name
      : "",
    contact_path_source: "search_results",
    search_result_position: position,
  });
}

function handleCopyContact(contactType, therapist, value) {
  navigator.clipboard.writeText(value).then(function () {
    // Track: contact_path_copied
    trackEvent(TRACK_EVENTS.CONTACT_PATH_COPIED, {
      contact_type: contactType,
      therapist_id: therapist.id,
      contact_value_type: contactType,
      organization_name: therapist.intakeOrganization
        ? therapist.intakeOrganization.name
        : "",
    });
    alert("Copied: " + value);
  });
}

function handleIntakeOrgSelect(therapist, org, position) {
  // Track: intake_organization_selected
  trackEvent(TRACK_EVENTS.INTAKE_ORGANIZATION_SELECTED, {
    organization_id: org.id,
    organization_name: org.name,
    therapist_id: therapist.id,
    therapists_covered_count: org.therapistsCovered,
    contact_method_used: "phone",
  });

  // Also track as a contact path initiation
  trackEvent(TRACK_EVENTS.CONTACT_PATH_INITIATED, {
    contact_type: "shared_intake",
    therapist_id: therapist.id,
    therapist_name: therapist.name,
    organization_name: org.name,
    contact_path_source: "search_results",
    search_result_position: position,
  });
}

// --- Rendering ---

function renderResults(results) {
  resultsSummary.textContent =
    results.length === 0
      ? "No therapists found. Try adjusting your search or filters."
      : results.length + " therapist" + (results.length !== 1 ? "s" : "") + " found";

  resultsContainer.innerHTML = "";

  results.forEach(function (therapist, index) {
    const position = index + 1;
    const card = document.createElement("div");
    card.className = "therapist-card";

    const header = document.createElement("h3");
    header.textContent = therapist.name;
    card.appendChild(header);

    const details = document.createElement("p");
    details.textContent =
      therapist.location +
      " · " +
      therapist.specialty.join(", ") +
      " · Ages " +
      therapist.ageRange;
    card.appendChild(details);

    const insurance = document.createElement("p");
    insurance.className = "insurance";
    insurance.textContent = "Accepts: " + therapist.insurance.join(", ");
    card.appendChild(insurance);

    const contacts = document.createElement("div");
    contacts.className = "contact-paths";

    // Phone
    if (therapist.phone) {
      const phoneLink = document.createElement("a");
      phoneLink.href = "tel:" + therapist.phone;
      phoneLink.textContent = "Call " + therapist.phone;
      phoneLink.addEventListener("click", function () {
        handleContactClick("phone", therapist, position);
      });
      contacts.appendChild(phoneLink);

      const copyPhoneBtn = document.createElement("button");
      copyPhoneBtn.textContent = "Copy phone";
      copyPhoneBtn.addEventListener("click", function () {
        handleCopyContact("phone", therapist, therapist.phone);
      });
      contacts.appendChild(copyPhoneBtn);
    }

    // Email
    if (therapist.email) {
      const emailLink = document.createElement("a");
      emailLink.href = "mailto:" + therapist.email;
      emailLink.textContent = "Email";
      emailLink.addEventListener("click", function () {
        handleContactClick("email", therapist, position);
      });
      contacts.appendChild(emailLink);

      const copyEmailBtn = document.createElement("button");
      copyEmailBtn.textContent = "Copy email";
      copyEmailBtn.addEventListener("click", function () {
        handleCopyContact("email", therapist, therapist.email);
      });
      contacts.appendChild(copyEmailBtn);
    }

    // Website
    if (therapist.website) {
      const webLink = document.createElement("a");
      webLink.href = therapist.website;
      webLink.target = "_blank";
      webLink.rel = "noopener";
      webLink.textContent = "Website";
      webLink.addEventListener("click", function () {
        handleContactClick("website", therapist, position);
      });
      contacts.appendChild(webLink);
    }

    // Psychology Today
    if (therapist.psychologyTodayUrl) {
      const ptLink = document.createElement("a");
      ptLink.href = therapist.psychologyTodayUrl;
      ptLink.target = "_blank";
      ptLink.rel = "noopener";
      ptLink.textContent = "Psychology Today";
      ptLink.addEventListener("click", function () {
        handleContactClick("psychology_today", therapist, position);
      });
      contacts.appendChild(ptLink);
    }

    // Shared intake organization
    if (therapist.intakeOrganization) {
      const org = therapist.intakeOrganization;
      const orgBtn = document.createElement("button");
      orgBtn.className = "intake-org-btn";
      orgBtn.textContent =
        "Contact via " + org.name + " (" + org.therapistsCovered + " therapists)";
      orgBtn.addEventListener("click", function () {
        handleIntakeOrgSelect(therapist, org, position);
        window.open("tel:" + org.phone);
      });
      contacts.appendChild(orgBtn);
    }

    card.appendChild(contacts);
    resultsContainer.appendChild(card);
  });
}

// Initial render — show all therapists
renderResults(therapists);
