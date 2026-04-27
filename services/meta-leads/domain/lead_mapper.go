package domain

import (
	"strings"
	"time"
)

var knownFieldMapping = map[string]string{
	"first_name": "first_name",
	"last_name":  "last_name",
	"email":      "email",
	"phone":      "phone",
	"phone_number": "phone",
	"company":    "company",
	"company_name": "company",
	"full_name":  "full_name",
}

func MapGraphLeadToEvent(tenantID, pageID string, lead *GraphLead) *LeadCreatedEvent {
	externalID := MakeExternalID(pageID, lead.ID)

	event := &LeadCreatedEvent{
		Type:           EventLeadCreated,
		TenantID:       tenantID,
		LeadID:         externalID,
		Source:         "social_media",
		ExternalSource: "meta",
		ExternalID:     externalID,
		CustomFields:   make(map[string]string),
		Meta: LeadMetaInfo{
			PageID:      pageID,
			FormID:      lead.FormID,
			AdID:        lead.AdID,
			CreatedTime: lead.CreatedTime,
		},
		IngestedAt: time.Now().UTC(),
	}

	for _, field := range lead.FieldData {
		val := ""
		if len(field.Values) > 0 {
			val = field.Values[0]
		}
		if val == "" {
			continue
		}

		normalized := strings.ToLower(strings.TrimSpace(field.Name))
		if mapped, ok := knownFieldMapping[normalized]; ok {
			switch mapped {
			case "first_name":
				event.FirstName = val
			case "last_name":
				event.LastName = val
			case "email":
				event.Email = val
			case "phone":
				event.Phone = val
			case "company":
				event.Company = val
			case "full_name":
				parts := strings.SplitN(val, " ", 2)
				event.FirstName = parts[0]
				if len(parts) > 1 {
					event.LastName = parts[1]
				}
			}
		} else {
			event.CustomFields[field.Name] = val
		}
	}

	return event
}
