import type { CommandSpec } from "@/engine/cli/command-spec";
import { notImplemented } from "@/engine/commands/shared";

/**
 * 解決はできるが未実装のコマンド（DJ-005: それっぽく成功させず E-002 で返す）。
 * ACE の出題範囲（設計書 3.1）にあって Phase 1 で実装していないものを並べる。
 */
export const NotImplementedCommands: readonly CommandSpec[] = [
  notImplemented(["gcloud", "compute", "ssh"], "SSH into a virtual machine instance."),
  notImplemented(
    ["gcloud", "compute", "scp"],
    "Copy files to and from Google Compute Engine virtual machines via scp.",
  ),
  notImplemented(
    ["gcloud", "compute", "instances", "add-tags"],
    "Add tags to Compute Engine virtual machine instances.",
  ),
  notImplemented(
    ["gcloud", "compute", "instances", "set-machine-type"],
    "Set machine type for Compute Engine virtual machines.",
  ),
  notImplemented(
    ["gcloud", "compute", "instances", "add-metadata"],
    "Add or update instance metadata.",
  ),
  notImplemented(
    ["gcloud", "compute", "instances", "attach-disk"],
    "Attach a disk to an instance.",
  ),
  notImplemented(
    ["gcloud", "compute", "instance-templates", "create"],
    "Create a Compute Engine virtual machine instance template.",
  ),
  notImplemented(
    ["gcloud", "compute", "instance-templates", "list"],
    "List Compute Engine virtual machine instance templates.",
  ),
  notImplemented(
    ["gcloud", "compute", "instance-groups", "managed", "create"],
    "Create a Compute Engine managed instance group.",
  ),
  notImplemented(
    ["gcloud", "compute", "instance-groups", "managed", "list"],
    "List Compute Engine managed instance groups.",
  ),
  notImplemented(
    ["gcloud", "compute", "instance-groups", "managed", "set-autoscaling"],
    "Set autoscaling parameters of a managed instance group.",
  ),
  notImplemented(
    ["gcloud", "compute", "disks", "create"],
    "Create Compute Engine persistent disks.",
  ),
  notImplemented(
    ["gcloud", "compute", "disks", "snapshot"],
    "Create snapshots of Compute Engine persistent disks.",
  ),
  notImplemented(["gcloud", "compute", "disks", "resize"], "Resize a disk or disks."),
  notImplemented(["gcloud", "compute", "addresses", "create"], "Reserve IP addresses."),
  notImplemented(["gcloud", "compute", "addresses", "list"], "List addresses."),
  notImplemented(["gcloud", "compute", "routers", "create"], "Create a Compute Engine router."),
  notImplemented(
    ["gcloud", "compute", "networks", "peerings", "create"],
    "Create a Compute Engine network peering.",
  ),
  notImplemented(
    ["gcloud", "compute", "project-info", "describe"],
    "Describe the Compute Engine project resource.",
  ),
  notImplemented(
    ["gcloud", "compute", "project-info", "add-metadata"],
    "Add or update project-wide metadata.",
  ),
  notImplemented(
    ["gcloud", "compute", "os-login", "ssh-keys", "add"],
    "Add an SSH public key to an OS Login profile.",
  ),
  notImplemented(["gcloud", "compute", "health-checks", "create"], "Create a health check."),
  notImplemented(["gcloud", "compute", "backend-services", "create"], "Create a backend service."),
  notImplemented(["gcloud", "compute", "forwarding-rules", "create"], "Create a forwarding rule."),
  notImplemented(
    ["gcloud", "container", "clusters", "resize"],
    "Resizes an existing cluster for running containers.",
  ),
  notImplemented(
    ["gcloud", "container", "clusters", "upgrade"],
    "Upgrade the Kubernetes version of an existing container cluster.",
  ),
  notImplemented(
    ["gcloud", "container", "node-pools", "create"],
    "Create a node pool in a running cluster.",
  ),
  notImplemented(
    ["gcloud", "container", "node-pools", "list"],
    "List node pools in a running cluster.",
  ),
  notImplemented(["gcloud", "functions", "deploy"], "Create or update a Google Cloud Function."),
  notImplemented(["gcloud", "functions", "list"], "List Google Cloud Functions."),
  notImplemented(["gcloud", "functions", "delete"], "Delete a Google Cloud Function."),
  notImplemented(["gcloud", "functions", "call"], "Trigger execution of a Google Cloud Function."),
  notImplemented(
    ["gcloud", "app", "deploy"],
    "Deploy the local code and/or configuration of your app to App Engine.",
  ),
  notImplemented(["gcloud", "app", "browse"], "Open the current app in a web browser."),
  notImplemented(
    ["gcloud", "app", "versions", "list"],
    "List the versions of all services in the App Engine server.",
  ),
  notImplemented(["gcloud", "app", "services", "set-traffic"], "Set traffic splitting settings."),
  notImplemented(["gcloud", "sql", "instances", "create"], "Create a new Cloud SQL instance."),
  notImplemented(
    ["gcloud", "sql", "instances", "list"],
    "List Cloud SQL instances in a given project.",
  ),
  notImplemented(["gcloud", "sql", "instances", "delete"], "Delete a Cloud SQL instance."),
  notImplemented(
    ["gcloud", "sql", "backups", "create"],
    "Create a backup of a Cloud SQL instance.",
  ),
  notImplemented(
    ["gcloud", "pubsub", "topics", "create"],
    "Create one or more Cloud Pub/Sub topics.",
  ),
  notImplemented(["gcloud", "pubsub", "topics", "list"], "List Cloud Pub/Sub topics."),
  notImplemented(
    ["gcloud", "pubsub", "subscriptions", "create"],
    "Create one or more Cloud Pub/Sub subscriptions.",
  ),
  notImplemented(["gcloud", "logging", "read"], "Read log entries."),
  notImplemented(["gcloud", "logging", "logs", "list"], "List logs in a project."),
  notImplemented(["gcloud", "logging", "sinks", "create"], "Create a log sink."),
  notImplemented(["gcloud", "monitoring", "dashboards", "list"], "List Monitoring dashboards."),
  notImplemented(["gcloud", "monitoring", "policies", "list"], "List alert policies."),
  notImplemented(
    ["gcloud", "iam", "roles", "create"],
    "Create a custom role for a project or an organization.",
  ),
  notImplemented(["gcloud", "iam", "roles", "copy"], "Create a role from an existing role."),
  notImplemented(
    ["gcloud", "iam", "service-accounts", "keys", "create"],
    "Create a private key for a service account.",
  ),
  notImplemented(
    ["gcloud", "iam", "service-accounts", "add-iam-policy-binding"],
    "Add an IAM policy binding to a service account.",
  ),
  notImplemented(["gcloud", "kms", "keyrings", "create"], "Create a new keyring."),
  notImplemented(["gcloud", "dns", "managed-zones", "create"], "Create a Cloud DNS managed-zone."),
  notImplemented(["gcloud", "deployment-manager", "deployments", "create"], "Create a deployment."),
  notImplemented(
    ["gcloud", "storage", "buckets", "update"],
    "Update Cloud Storage buckets (lifecycle, versioning, ...).",
  ),
  notImplemented(["gcloud", "storage", "objects", "update"], "Update Cloud Storage objects."),
  notImplemented(["gcloud", "storage", "rsync"], "Synchronize content of two buckets/directories."),
  notImplemented(["gcloud", "storage", "sign-url"], "Generate a URL with embedded authentication."),
  notImplemented(["gcloud", "components", "install"], "Install specified components."),
  notImplemented(["gcloud", "components", "update"], "Update all of your installed components."),
  notImplemented(["gcloud", "init"], "Initialize or reinitialize gcloud."),
  notImplemented(["gcloud", "info"], "Display information about the current gcloud environment."),
  notImplemented(
    ["gcloud", "version"],
    "Print version information for Google Cloud CLI components.",
  ),
  notImplemented(
    ["gcloud", "auth", "activate-service-account"],
    "Authorize access to Google Cloud with a service account credential file.",
  ),
  notImplemented(
    ["gcloud", "auth", "application-default", "login"],
    "Acquire new user credentials to use for Application Default Credentials.",
  ),
  notImplemented(
    ["gsutil", "iam", "ch"],
    "Change a bucket's IAM policy (use gcloud storage buckets add-iam-policy-binding).",
  ),
  notImplemented(["gsutil", "rsync"], "Synchronize content of two buckets/directories."),
  notImplemented(["gsutil", "lifecycle", "set"], "Set lifecycle configuration for a bucket."),
  notImplemented(["gsutil", "versioning", "set"], "Enable or disable versioning for a bucket."),
  notImplemented(["gsutil", "acl", "ch"], "Change bucket or object ACLs."),
  notImplemented(["kubectl", "get"], "Display one or many resources."),
  notImplemented(
    ["kubectl", "apply"],
    "Apply a configuration to a resource by file name or stdin.",
  ),
  notImplemented(["kubectl", "create"], "Create a resource from a file or from stdin."),
  notImplemented(["kubectl", "delete"], "Delete resources."),
  notImplemented(
    ["kubectl", "describe"],
    "Show details of a specific resource or group of resources.",
  ),
  notImplemented(["kubectl", "expose"], "Expose a resource as a new Kubernetes service."),
  notImplemented(
    ["kubectl", "scale"],
    "Set a new size for a deployment, replica set, or replication controller.",
  ),
  notImplemented(["kubectl", "rollout"], "Manage the rollout of a resource."),
  notImplemented(["kubectl", "logs"], "Print the logs for a container in a pod."),
  notImplemented(["kubectl", "config"], "Modify kubeconfig files."),
];
